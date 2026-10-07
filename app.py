import os
import sys
from datetime import datetime
from flask import Flask, render_template, abort, request, jsonify
from sqlalchemy import event
from sqlalchemy.engine import Engine

from models import (
    db,
    EOPCRF2Rating,
    EOPCRF1Kra,
    EOPCRF1Objective,
    EOPCRF1Indicator,
    EOPCRF1_CATEGORIES,
    EOPCRF1_PART_B,
    seed_eopcrf1_defaults,
    EOPCRF4Row,
    EOPCRF4Feedback,
    EOPCRF4_PARTS,
    EOPCRF4_POSITIONS,
    ReportPreparer,
    EOPCRF1ApprovingAuthority,
    EOPCRF1ReportHeader,
    ReportSignatoryDate,
    EOPCRF2_SECTION_LEADERSHIP,
    EOPCRF2_SECTION_CBC,
)


def _resource_dir():
    """Where templates/ and static/ live. Read-only, so it's fine for this
    to sit inside PyInstaller's temp extraction folder (sys._MEIPASS) when
    frozen -- that folder just needs to exist for the life of the run."""
    if getattr(sys, "frozen", False):
        return sys._MEIPASS
    return os.path.abspath(os.path.dirname(__file__))


def _data_dir():
    """Where the SQLite file lives. This MUST be a stable, writable,
    per-user location -- never PyInstaller's temp extraction folder, which
    is deleted the moment the app closes (that would wipe the database on
    every restart). In dev (not frozen) we keep using the project folder
    for convenience; once frozen we switch to the OS's standard per-user
    app-data location."""
    if getattr(sys, "frozen", False):
        if sys.platform == "win32":
            root = os.environ.get("LOCALAPPDATA", os.path.expanduser("~"))
        elif sys.platform == "darwin":
            root = os.path.expanduser("~/Library/Application Support")
        else:
            root = os.environ.get("XDG_DATA_HOME", os.path.expanduser("~/.local/share"))
        return os.path.join(root, "EOPCRF_SH")
    return os.path.abspath(os.path.dirname(__file__))


app = Flask(
    __name__,
    template_folder=os.path.join(_resource_dir(), "templates"),
    static_folder=os.path.join(_resource_dir(), "static"),
)

# ---------------------------------------------------------------------------
# Database configuration
# ---------------------------------------------------------------------------
BASE_DIR = _data_dir()
INSTANCE_DIR = os.path.join(BASE_DIR, "instance")
os.makedirs(INSTANCE_DIR, exist_ok=True)

app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///" + os.path.join(INSTANCE_DIR, "eopcrf_sh.db")
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

db.init_app(app)


# SQLite ON DELETE CASCADE only works if foreign_keys is turned on -- it's
# OFF by default. This is a belt-and-suspenders measure: KRA -> Objective ->
# Indicator deletion also cascades via the ORM regardless (see models.py's
# cascade="all, delete-orphan"), but this protects against anything that
# ever deletes rows outside the ORM.
@event.listens_for(Engine, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):  # noqa: ARG001
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


def _ensure_eopcrf1_schema():
    """Lightweight, dependency-free migration for the `part` column added
    to eopcrf1_kras when Part I-A/I-B/I-C was introduced. db.create_all()
    only creates missing *tables*, never adds missing *columns* to a table
    that already exists -- so on an existing eopcrf_sh.db (from before this
    column existed) the ORM would otherwise error the first time it reads
    or writes a KRA. Safe to call on every app start: a no-op once the
    column is there, and a no-op on a brand-new DB where create_all()
    already created the table with the column in place."""
    with db.engine.connect() as conn:
        cols = [row[1] for row in conn.exec_driver_sql("PRAGMA table_info(eopcrf1_kras)").fetchall()]
        if cols and "part" not in cols:
            conn.exec_driver_sql(
                f"ALTER TABLE eopcrf1_kras ADD COLUMN part VARCHAR(1) NOT NULL DEFAULT '{EOPCRF1_PART_B}'"
            )
            conn.commit()

        # Columns added for the Organizational Outcomes Alignment fields
        # (per KRA) and the Performance Target / listed-MOV fields (per
        # objective). Same idea as `part` above: no-ops once present.
        kra_cols = [row[1] for row in conn.exec_driver_sql("PRAGMA table_info(eopcrf1_kras)").fetchall()]
        for col in ("gaa_program", "bedp_pillars", "admin_agenda"):
            if kra_cols and col not in kra_cols:
                conn.exec_driver_sql(f"ALTER TABLE eopcrf1_kras ADD COLUMN {col} TEXT")
        obj_cols = [row[1] for row in conn.exec_driver_sql("PRAGMA table_info(eopcrf1_objectives)").fetchall()]
        for col, ddl in (("target_value", "VARCHAR(100)"), ("target_description", "TEXT"), ("mov_required", "TEXT")):
            if obj_cols and col not in obj_cols:
                conn.exec_driver_sql(f"ALTER TABLE eopcrf1_objectives ADD COLUMN {col} {ddl}")
        conn.commit()


def _ensure_seeded_kras(year):
    """Makes sure the fixed Part I-A / Part I-C structure exists for this
    year before it's read or written. See seed_eopcrf1_defaults() in
    models.py -- idempotent, so calling this on every request is cheap
    (one indexed lookup) once a year's KRAs already exist."""
    seed_eopcrf1_defaults(year)


def _ensure_eopcrf2_schema():
    """One-time, idempotent carry-over from the old IRC8b tab to EOPCRF2.
    Part II was re-based on the official form, so only the Core
    Behavioural rows can be carried over (Core Skills no longer exists;
    "result_focus" became "results_focus"). Also moves any
    report_signatory_date rows saved under the old "irc8b" tab id.
    Safe on every start: does nothing unless the old table/rows exist and
    the new table is still empty for that row."""
    with db.engine.connect() as conn:
        tables = {r[0] for r in conn.exec_driver_sql("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
        if "irc8b_ratings" in tables and "eopcrf2_ratings" in tables:
            conn.exec_driver_sql(
                """
                INSERT INTO eopcrf2_ratings (year, section_key, subsection_key, criterion_index, rating, remarks, updated_at)
                SELECT o.year, 'cbc',
                       CASE o.subsection_key WHEN 'result_focus' THEN 'results_focus' ELSE o.subsection_key END,
                       o.criterion_index, o.rating, '', o.updated_at
                FROM irc8b_ratings o
                WHERE o.section_key = 'cbc'
                  AND NOT EXISTS (
                    SELECT 1 FROM eopcrf2_ratings n
                    WHERE n.year = o.year
                      AND n.subsection_key = CASE o.subsection_key WHEN 'result_focus' THEN 'results_focus' ELSE o.subsection_key END
                      AND n.criterion_index = o.criterion_index
                  )
                """
            )
        if "report_signatory_date" in tables:
            conn.exec_driver_sql(
                """
                UPDATE report_signatory_date SET tab_id = 'eopcrf2'
                WHERE tab_id = 'irc8b'
                  AND NOT EXISTS (
                    SELECT 1 FROM report_signatory_date n
                    WHERE n.tab_id = 'eopcrf2' AND n.role = report_signatory_date.role
                  )
                """
            )
        conn.commit()


@app.cli.command("init-db")
def init_db_command():
    """Usage: flask --app app init-db
    Creates all tables (if missing). Safe to run more than once."""
    with app.app_context():
        db.create_all()
        _ensure_eopcrf1_schema()
        _ensure_eopcrf2_schema()
        print(f"Database ready at {app.config['SQLALCHEMY_DATABASE_URI']}")


# ---------------------------------------------------------------------------
# Fixed list of tabs. This system has exactly 4 Individual Report Cards
# (EOPCRF1, EOPCRF2, EOPCRF3, EOPCRF4) and this list will not grow.
# ---------------------------------------------------------------------------
TABS = [
    {"id": "eopcrf1", "short": "EOPCRF I", "part": "Part I", "name": "EOPCRF Part I", "desc": "Individual Performance Commitment and Review Form (IPCRF)"},
    {"id": "eopcrf2", "short": "EOPCRF II", "part": "Part II", "name": "EOPCRF Part II", "desc": "Leadership and Core Behavioral Competencies"},
    {"id": "eopcrf3", "short": "EOPCRF III", "part": "Part III", "name": "EOPCRF Part III", "desc": "Summary of Ratings"},
    {"id": "eopcrf4", "short": "EOPCRF IV", "part": "Part IV", "name": "EOPCRF Part IV", "desc": "Improvement and Development Plans"},
]

# Quick lookup by id, e.g. TAB_LOOKUP["eopcrf1"]
TAB_LOOKUP = {tab["id"]: tab for tab in TABS}

# Each tab renders its own template file under templates/tabs/, since every
# report card has its own structure/functionality. E.g. "eopcrf1" -> "tabs/eopcrf1.html"
TEMPLATE_MAP = {tab["id"]: f"tabs/{tab['id']}.html" for tab in TABS}


def _current_year():
    return datetime.now().year


def _get_preparer():
    """Single global row holding the 'Prepared by' name/position (see
    ReportPreparer in models.py). Created lazily with blank fields on
    first access so callers never have to special-case "no row yet"."""
    preparer = ReportPreparer.query.first()
    if preparer is None:
        preparer = ReportPreparer(name="", position="")
        db.session.add(preparer)
        db.session.commit()
    return preparer


def _get_eopcrf1_approving_authority():
    """Single global row holding EOPCRF1's 'Approving Authority' name (see
    EOPCRF1ApprovingAuthority in models.py). Created lazily with a blank name
    on first access, same convention as _get_preparer() above."""
    authority = EOPCRF1ApprovingAuthority.query.first()
    if authority is None:
        authority = EOPCRF1ApprovingAuthority(name="")
        db.session.add(authority)
        db.session.commit()
    return authority


def _get_eopcrf1_report_header():
    """Single global row holding EOPCRF1's printed-report header fields (see
    EOPCRF1ReportHeader in models.py). Created lazily with blank fields on
    first access, same convention as _get_preparer() /
    _get_eopcrf1_approving_authority() above."""
    header = EOPCRF1ReportHeader.query.first()
    if header is None:
        header = EOPCRF1ReportHeader()
        db.session.add(header)
        db.session.commit()
    return header


SIGNATORY_ROLES = {"prepared_by", "checked_by", "approving_authority"}


def _get_signatory_date(tab_id, role):
    """Single row per (tab_id, role) holding the calendar-picked date shown
    under that signatory's position in the report-signatory footer (see
    ReportSignatoryDate in models.py). Created lazily with a blank date on
    first access, same convention as _get_preparer() above."""
    row = ReportSignatoryDate.query.filter_by(tab_id=tab_id, role=role).first()
    if row is None:
        row = ReportSignatoryDate(tab_id=tab_id, role=role, date=None)
        db.session.add(row)
        db.session.commit()
    return row


@app.route("/")
def home():
    """Landing page shown when the app first opens: a masthead plus a card
    for each of the four IRC8 report cards."""
    return render_template(
        "home.html",
        tabs=TABS,
        active_tab=None,
        preparer=_get_preparer(),
    )


@app.route("/api/preparer", methods=["GET"])
def get_preparer():
    """Read-only fetch used by base.html's report-signatory footer on every
    tab to fill in the current 'Prepared by' name/position."""
    preparer = _get_preparer()
    return jsonify({"name": preparer.name, "position": preparer.position}), 200


@app.route("/api/preparer", methods=["POST"])
def save_preparer():
    """Saves the 'Prepared by' name/position typed on the Home page. Single
    global row -- intentionally not year-scoped and never touched by any
    tab's Reset (see ReportPreparer in models.py)."""
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    position = (data.get("position") or "").strip()

    preparer = _get_preparer()
    preparer.name = name
    preparer.position = position
    db.session.commit()

    return jsonify({"name": preparer.name, "position": preparer.position}), 200


@app.route("/api/eopcrf1/approving-authority", methods=["GET"])
def get_eopcrf1_approving_authority():
    """Read-only fetch used by base.html's report-signatory footer, on the
    EOPCRF1 page only, to fill in the current 'Approving Authority' name."""
    authority = _get_eopcrf1_approving_authority()
    return jsonify({"name": authority.name}), 200


@app.route("/api/eopcrf1/approving-authority", methods=["POST"])
def save_eopcrf1_approving_authority():
    """Saves the 'Approving Authority' name typed directly in EOPCRF1's
    report-signatory footer. Single global row -- not year-scoped and
    intentionally untouched by EOPCRF1's Reset."""
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()

    authority = _get_eopcrf1_approving_authority()
    authority.name = name
    db.session.commit()

    return jsonify({"name": authority.name}), 200


@app.route("/api/eopcrf1/report-header", methods=["GET"])
def get_eopcrf1_report_header():
    """Read-only fetch used by eopcrf1.js to fill in the printed-report
    header fields (Name of Rater/Employee, their Positions, Bureau/Center/
    Service/Division, Rating Period, Date of Review) shown at the top of
    the EOPCRF1 page and reproduced in its Save-to-PDF output."""
    header = _get_eopcrf1_report_header()
    return jsonify(header.to_dict()), 200


@app.route("/api/eopcrf1/report-header", methods=["POST"])
def save_eopcrf1_report_header():
    """Saves EOPCRF1's printed-report header fields, typed directly on the
    EOPCRF1 page. Single global row -- not year-scoped and intentionally
    untouched by EOPCRF1's Reset. Accepts a partial body -- any field
    omitted is left as-is rather than cleared, so each input can save
    independently on blur without clobbering the others."""
    data = request.get_json(silent=True) or {}
    header = _get_eopcrf1_report_header()

    text_fields = {
        "nameOfRater": "name_of_rater",
        "positionOfRater": "position_of_rater",
        "nameOfEmployee": "name_of_employee",
        "positionOfEmployee": "position_of_employee",
        "bureau": "bureau",
        "ratingPeriod": "rating_period",
    }
    for json_key, column in text_fields.items():
        if json_key in data:
            setattr(header, column, (data.get(json_key) or "").strip())

    if "dateOfReview" in data:
        date_str = (data.get("dateOfReview") or "").strip()
        if date_str:
            try:
                header.date_of_review = datetime.strptime(date_str, "%Y-%m-%d").date()
            except ValueError:
                return jsonify({"error": "Invalid date format, expected YYYY-MM-DD"}), 400
        else:
            header.date_of_review = None

    db.session.commit()
    return jsonify(header.to_dict()), 200


@app.route("/api/signatory-date/<tab_id>/<role>", methods=["GET"])
def get_signatory_date(tab_id, role):
    """Read-only fetch used by base.html's report-signatory footer, on
    every tab, to fill in the calendar-picked date under whichever
    signatory block(s) it renders (Prepared by / Checked by, plus
    Approving Authority on eopcrf1 only)."""
    if tab_id not in TAB_LOOKUP or role not in SIGNATORY_ROLES:
        return jsonify({"error": "Invalid tab or role"}), 400
    row = _get_signatory_date(tab_id, role)
    return jsonify({"date": row.date.isoformat() if row.date else None}), 200


@app.route("/api/signatory-date/<tab_id>/<role>", methods=["POST"])
def save_signatory_date(tab_id, role):
    """Saves the date picked from the pop-up calendar under a signatory's
    position. Scoped to this exact (tab, role) pair. Expects
    {"date": "YYYY-MM-DD"}, or {"date": null}/"" to clear it."""
    if tab_id not in TAB_LOOKUP or role not in SIGNATORY_ROLES:
        return jsonify({"error": "Invalid tab or role"}), 400

    data = request.get_json(silent=True) or {}
    date_str = (data.get("date") or "").strip()

    row = _get_signatory_date(tab_id, role)
    if date_str:
        try:
            row.date = datetime.strptime(date_str, "%Y-%m-%d").date()
        except ValueError:
            return jsonify({"error": "Invalid date format, expected YYYY-MM-DD"}), 400
    else:
        row.date = None
    db.session.commit()

    return jsonify({"date": row.date.isoformat() if row.date else None}), 200


@app.route("/irc/<tab_id>")
def view_tab(tab_id):
    """Renders the dedicated template for whichever tab was requested.
    Templates are static markup with no server-side value binding -- each
    tab's own JS is responsible for fetching /irc/<tab_id>/data on load and
    populating the page client-side (see eopcrf1.js, eopcrf2.js, eopcrf3.js,
    eopcrf4.js)."""
    active_tab = TAB_LOOKUP.get(tab_id)
    if active_tab is None:
        abort(404)
    return render_template(TEMPLATE_MAP[tab_id], tabs=TABS, active_tab=active_tab)


# ---------------------------------------------------------------------------
# EOPCRF2 -- Part II: Leadership Competencies and Core Behavioural Competencies
# ---------------------------------------------------------------------------
@app.route("/irc/eopcrf2/data", methods=["GET"])
# Back-compat alias: any page still fetching the old "/irc/irc8b/data" path. The "ratings" shape is
# unchanged ({subsectionKey: {index: rating}}), so they keep working.
@app.route("/irc/irc8b/data", methods=["GET"])
def get_eopcrf2_data():
    year = request.args.get("year", type=int) or _current_year()
    rows = EOPCRF2Rating.query.filter_by(year=year).all()

    ratings = {}
    remarks = {}
    # subsection_key -> section_key ("leadership" | "cbc"), so eopcrf3.js
    # can group subsection averages into Part II-A / II-B without
    # duplicating eopcrf2.js's hardcoded DATA. Additive: existing callers
    # that only read "ratings"/"remarks" are unaffected.
    sections = {}
    for row in rows:
        sections[row.subsection_key] = row.section_key
        if row.rating is not None:
            ratings.setdefault(row.subsection_key, {})[str(row.criterion_index)] = row.rating
        if row.remarks:
            remarks.setdefault(row.subsection_key, {})[str(row.criterion_index)] = row.remarks

    return jsonify({"year": year, "ratings": ratings, "remarks": remarks, "sections": sections}), 200


@app.route("/irc/eopcrf2/rating", methods=["POST"])
def save_eopcrf2_rating():
    """Expected JSON body:
        { "year": 2026, "sectionKey": "cbc", "subsectionKey": "self_management",
          "criterionIndex": 0, "rating": 4, "remarks": "Optional text" }

    'rating' and 'remarks' are each optional -- only the fields present in
    the body are changed. rating: null clears a previously-set rating
    (eopcrf2.js does this when the user clicks an already-selected button);
    remarks: "" clears the remark.
    """
    data = request.get_json(silent=True) or {}
    year = data.get("year") or _current_year()
    section_key = data.get("sectionKey")
    subsection_key = data.get("subsectionKey")
    criterion_index = data.get("criterionIndex")

    if section_key not in (EOPCRF2_SECTION_LEADERSHIP, EOPCRF2_SECTION_CBC):
        return jsonify({"error": f"Invalid sectionKey: {section_key!r}"}), 400
    if not subsection_key or criterion_index is None:
        return jsonify({"error": "'subsectionKey' and 'criterionIndex' are required"}), 400
    if "rating" in data and data["rating"] is not None and data["rating"] not in (1, 2, 3, 4, 5):
        return jsonify({"error": f"Invalid rating: {data['rating']!r}"}), 400
    if "remarks" in data and data["remarks"] is not None and not isinstance(data["remarks"], str):
        return jsonify({"error": "'remarks' must be a string"}), 400

    row = EOPCRF2Rating.query.filter_by(
        year=year, subsection_key=subsection_key, criterion_index=criterion_index
    ).first()
    if row is None:
        row = EOPCRF2Rating(year=year, subsection_key=subsection_key, criterion_index=criterion_index, remarks="")
        db.session.add(row)
    row.section_key = section_key
    if "rating" in data:
        row.rating = data["rating"]
    if "remarks" in data:
        row.remarks = (data["remarks"] or "")[:500]
    db.session.commit()

    return jsonify({
        "year": year,
        "sectionKey": section_key,
        "subsectionKey": subsection_key,
        "criterionIndex": criterion_index,
        "rating": row.rating,
        "remarks": row.remarks,
    }), 200


# ---------------------------------------------------------------------------
# EOPCRF1 -- Individual Performance Commitment and Review Form (IPCRF)
#
# These routes just persist whatever the KRA / Objective / rubric-indicator
# modals in eopcrf1.js submit. See the EOPCRF1* section of models.py for the
# full rationale behind the KRA -> Objective -> Indicator shape.
# ---------------------------------------------------------------------------
def _validate_weight(raw):
    """Returns (weight_or_None, error_message_or_None). Mirrors eopcrf1.js's
    own "Weight must be a number between 0 and 100" client-side check."""
    if raw in (None, ""):
        return None, None
    try:
        weight = float(raw)
    except (TypeError, ValueError):
        return None, "Weight must be a number between 0 and 100."
    if weight < 0 or weight > 100:
        return None, "Weight must be a number between 0 and 100."
    return weight, None


@app.route("/irc/eopcrf1/data", methods=["GET"])
# Back-compat alias: the old "/irc/irc8a/data" path. Keeping both routes
# alive means any page still fetching it keeps working even though this
# tab moved to "eopcrf1".
@app.route("/irc/irc8a/data", methods=["GET"])
def get_eopcrf1_data():
    year = request.args.get("year", type=int) or _current_year()
    _ensure_seeded_kras(year)
    kras = (
        EOPCRF1Kra.query.filter_by(year=year)
        .order_by(EOPCRF1Kra.sort_order.asc(), EOPCRF1Kra.id.asc())
        .all()
    )
    return jsonify({"year": year, "kras": [k.to_dict() for k in kras]}), 200


@app.route("/irc/eopcrf1/kra", methods=["POST"])
def save_eopcrf1_kra():
    """Creates a new KRA (id omitted), or updates an existing one's text/
    weight (id included) -- a KRA's `year` is fixed at creation and never
    changes here.

    Expected JSON body:
        { "id": 3, "year": 2026, "text": "...", "weight": 25 }
    """
    data = request.get_json(silent=True) or {}
    kra_id = data.get("id")
    text = (data.get("text") or "").strip()
    if not text:
        return jsonify({"error": "Please describe the KRA."}), 400

    weight, err = _validate_weight(data.get("weight"))
    if err:
        return jsonify({"error": err}), 400

    if kra_id:
        kra = EOPCRF1Kra.query.get(kra_id)
        if kra is None:
            return jsonify({"error": "KRA not found"}), 404
        if kra.locked:
            return jsonify({"error": "This KRA is part of the fixed evaluation structure (Part I-A/I-C) and can't be edited."}), 403
    else:
        # Every KRA created through this endpoint lands in Part I-B --
        # Part I-A/I-C KRAs only ever come from seed_eopcrf1_defaults().
        year = data.get("year") or _current_year()
        max_order = db.session.query(db.func.max(EOPCRF1Kra.sort_order)).filter_by(year=year).scalar() or 0
        kra = EOPCRF1Kra(year=year, part=EOPCRF1_PART_B, sort_order=max_order + 1)
        db.session.add(kra)

    kra.text = text
    kra.weight = weight
    # Optional alignment fields -- only the keys present in the body change.
    for json_key, column in (("gaaProgram", "gaa_program"), ("bedpPillars", "bedp_pillars"), ("adminAgenda", "admin_agenda")):
        if json_key in data:
            setattr(kra, column, (data.get(json_key) or "").strip() or None)
    db.session.commit()
    return jsonify(kra.to_dict()), 200


@app.route("/irc/eopcrf1/kra/<int:kra_id>", methods=["DELETE"])
def delete_eopcrf1_kra(kra_id):
    kra = EOPCRF1Kra.query.get(kra_id)
    if kra is None:
        return jsonify({"error": "KRA not found"}), 404
    if kra.locked:
        return jsonify({"error": "This KRA is part of the fixed evaluation structure (Part I-A/I-C) and can't be deleted."}), 403
    db.session.delete(kra)  # cascades to its objectives and their indicators
    db.session.commit()
    return jsonify({"deleted": True, "id": kra_id}), 200


@app.route("/irc/eopcrf1/objective", methods=["POST"])
def save_eopcrf1_objective():
    """Creates a new Objective under `kraId` (id omitted), or updates an
    existing one's text/weight (id included).

    Expected JSON body:
        { "id": 9, "kraId": 3, "text": "...", "weight": 40 }
    """
    data = request.get_json(silent=True) or {}
    obj_id = data.get("id")
    text = (data.get("text") or "").strip()
    if not text:
        return jsonify({"error": "Please describe the objective."}), 400

    weight, err = _validate_weight(data.get("weight"))
    if err:
        return jsonify({"error": err}), 400

    if obj_id:
        objective = EOPCRF1Objective.query.get(obj_id)
        if objective is None:
            return jsonify({"error": "Objective not found"}), 404
        if objective.kra.locked:
            return jsonify({"error": "This objective is part of the fixed evaluation structure (Part I-A/I-C) and can't be edited."}), 403
    else:
        kra_id = data.get("kraId")
        kra = EOPCRF1Kra.query.get(kra_id) if kra_id else None
        if kra is None:
            return jsonify({"error": "KRA not found"}), 404
        if kra.locked:
            return jsonify({"error": "Objectives can't be added here -- this KRA is part of the fixed evaluation structure (Part I-A/I-C)."}), 403
        max_order = (
            db.session.query(db.func.max(EOPCRF1Objective.sort_order))
            .filter_by(kra_id=kra.id).scalar() or 0
        )
        objective = EOPCRF1Objective(kra_id=kra.id, sort_order=max_order + 1)
        db.session.add(objective)

    objective.text = text
    objective.weight = weight
    # Optional Performance Target / listed-MOV fields -- only keys present change.
    for json_key, column in (("targetValue", "target_value"), ("targetDescription", "target_description"), ("movRequired", "mov_required")):
        if json_key in data:
            setattr(objective, column, (data.get(json_key) or "").strip() or None)
    db.session.commit()
    return jsonify(objective.to_dict()), 200


@app.route("/irc/eopcrf1/objective/<int:obj_id>", methods=["DELETE"])
def delete_eopcrf1_objective(obj_id):
    objective = EOPCRF1Objective.query.get(obj_id)
    if objective is None:
        return jsonify({"error": "Objective not found"}), 404
    if objective.kra.locked:
        return jsonify({"error": "This objective is part of the fixed evaluation structure (Part I-A/I-C) and can't be deleted."}), 403
    db.session.delete(objective)  # cascades to its rubric indicators
    db.session.commit()
    return jsonify({"deleted": True, "id": obj_id}), 200


@app.route("/irc/eopcrf1/objective/<int:obj_id>/mov", methods=["POST"])
def save_eopcrf1_objective_mov(obj_id):
    """Expected JSON body: { "url": "https://..." }
    An empty/omitted url clears the MOV link, matching eopcrf1.js's
    delete-mov action."""
    objective = EOPCRF1Objective.query.get(obj_id)
    if objective is None:
        return jsonify({"error": "Objective not found"}), 404

    data = request.get_json(silent=True) or {}
    url = (data.get("url") or "").strip()
    objective.mov = url or None
    db.session.commit()
    return jsonify(objective.to_dict()), 200


@app.route("/irc/eopcrf1/objective/<int:obj_id>/actual-results", methods=["POST"])
def save_eopcrf1_objective_actual_results(obj_id):
    """Expected JSON body: { "text": "..." }"""
    objective = EOPCRF1Objective.query.get(obj_id)
    if objective is None:
        return jsonify({"error": "Objective not found"}), 404

    data = request.get_json(silent=True) or {}
    objective.actual_results = (data.get("text") or "").strip() or None
    db.session.commit()
    return jsonify(objective.to_dict()), 200


@app.route("/irc/eopcrf1/objective/<int:obj_id>/timeline", methods=["POST"])
def save_eopcrf1_objective_timeline(obj_id):
    """Expected JSON body: { "text": "..." }"""
    objective = EOPCRF1Objective.query.get(obj_id)
    if objective is None:
        return jsonify({"error": "Objective not found"}), 404

    data = request.get_json(silent=True) or {}
    objective.timeline = (data.get("text") or "").strip() or None
    db.session.commit()
    return jsonify(objective.to_dict()), 200


@app.route("/irc/eopcrf1/objective/<int:obj_id>/rating", methods=["POST"])
def save_eopcrf1_objective_rating(obj_id):
    """Sets (or clears) one category's selected rating on an objective --
    fired both by clicking a rubric indicator (select-indicator) and by
    picking a value directly from that category's dropdown.

    Expected JSON body: { "category": "quality", "rating": 4 }
    'rating' may be null/omitted to clear it."""
    objective = EOPCRF1Objective.query.get(obj_id)
    if objective is None:
        return jsonify({"error": "Objective not found"}), 404

    data = request.get_json(silent=True) or {}
    category = data.get("category")
    rating = data.get("rating")

    if category not in EOPCRF1_CATEGORIES:
        return jsonify({"error": f"Invalid category: {category!r}"}), 400
    if rating is not None and rating not in (1, 2, 3, 4, 5):
        return jsonify({"error": f"Invalid rating: {rating!r}"}), 400

    objective.set_rating(category, rating)
    db.session.commit()
    return jsonify(objective.to_dict()), 200


@app.route("/irc/eopcrf1/indicator", methods=["POST"])
def save_eopcrf1_indicator():
    """Creates a new rubric indicator under `objectiveId` (id omitted), or
    updates an existing one's rate/label (id included). A category is
    fixed at creation and never changes here.

    Expected JSON body:
        { "id": 5, "objectiveId": 9, "category": "quality", "rate": 3, "label": "..." }

    Rejects a rate already used by another indicator in the same
    (objective, category) -- matching populateRateOptions's "already
    used" filtering on the frontend, enforced here at the DB level too.
    """
    data = request.get_json(silent=True) or {}
    indicator_id = data.get("id")
    label = (data.get("label") or "").strip()
    rate = data.get("rate")

    if not label:
        return jsonify({"error": "Please describe what earns this rating level."}), 400
    if rate not in (1, 2, 3, 4, 5):
        return jsonify({"error": "Please select a rating level."}), 400

    if indicator_id:
        indicator = EOPCRF1Indicator.query.get(indicator_id)
        if indicator is None:
            return jsonify({"error": "Indicator not found"}), 404
        if indicator.objective.kra.locked:
            return jsonify({"error": "This indicator is part of the fixed evaluation structure (Part I-A/I-C) and can't be edited."}), 403
        objective_id = indicator.objective_id
        category = indicator.category  # fixed at creation
    else:
        indicator = None
        objective_id = data.get("objectiveId")
        category = data.get("category")
        if category not in EOPCRF1_CATEGORIES:
            return jsonify({"error": f"Invalid category: {category!r}"}), 400
        objective = EOPCRF1Objective.query.get(objective_id) if objective_id else None
        if objective is None:
            return jsonify({"error": "Objective not found"}), 404
        if objective.kra.locked:
            return jsonify({"error": "Indicators can't be added here -- this objective is part of the fixed evaluation structure (Part I-A/I-C)."}), 403
        if len(objective.indicators_for(category)) >= 5:
            return jsonify({"error": "At most 5 indicators are allowed per category."}), 400

    # Dupe check runs before the new row is added to the session (and
    # before any field is set on an existing one), so autoflush never
    # tries to insert/update a half-filled row while this query runs.
    dupe_query = EOPCRF1Indicator.query.filter_by(
        objective_id=objective_id, category=category, rate=rate
    )
    if indicator_id:
        dupe_query = dupe_query.filter(EOPCRF1Indicator.id != indicator_id)
    if dupe_query.first() is not None:
        return jsonify({"error": f"Rating level {rate} is already used for this category."}), 400

    if indicator is None:
        indicator = EOPCRF1Indicator(objective_id=objective_id, category=category)
        db.session.add(indicator)

    indicator.rate = rate
    indicator.label = label
    db.session.commit()
    return jsonify(indicator.to_dict()), 200


@app.route("/irc/eopcrf1/indicator/<int:indicator_id>", methods=["DELETE"])
def delete_eopcrf1_indicator(indicator_id):
    indicator = EOPCRF1Indicator.query.get(indicator_id)
    if indicator is None:
        return jsonify({"error": "Indicator not found"}), 404
    if indicator.objective.kra.locked:
        return jsonify({"error": "This indicator is part of the fixed evaluation structure (Part I-A/I-C) and can't be deleted."}), 403
    db.session.delete(indicator)
    db.session.commit()
    return jsonify({"deleted": True, "id": indicator_id}), 200


@app.route("/irc/eopcrf1/reset", methods=["DELETE"])
def reset_eopcrf1_data():
    """Two reset scopes for the "Reset All Data" button/modal, chosen via
    ?scope=ratings_mov|all (defaults to "ratings_mov"). eopcrf1.js reads the
    returned "scope" back to decide whether to clear ratings in place or
    drop every KRA client-side.

      - scope=ratings_mov (default): clears every objective's three
        ratings (quality/efficiency/timeliness) and its MOV link for the
        given year -- the "Clear ratings & MOV links only" option. KRAs,
        objectives, weights, rubric indicators, timeline, and actual
        results are left completely untouched.

      - scope=all: the "Reset entire form" option. Deletes every Part I-B
        KRA for the given year outright (cascading to its objectives and
        their rubric indicators). Part I-A/I-C's fixed structure can't be
        deleted, so it just falls through to the same ratings/MOV clearing
        "ratings_mov" does.
    """
    scope = request.args.get("scope", "ratings_mov")
    year = request.args.get("year", type=int) or _current_year()

    if scope == "all":
        # Only Part I-B (part="b") is user-managed, so "reset entire form"
        # only ever deletes those KRAs. Part I-A/I-C's fixed structure
        # can't be deleted -- it falls through to the same ratings/MOV
        # clearing the "ratings_mov" branch below does.
        EOPCRF1Kra.query.filter_by(year=year, part=EOPCRF1_PART_B).delete()
        db.session.commit()

    objectives = (
        EOPCRF1Objective.query.join(EOPCRF1Kra, EOPCRF1Objective.kra_id == EOPCRF1Kra.id)
        .filter(EOPCRF1Kra.year == year)
        .all()
    )
    for objective in objectives:
        for category in EOPCRF1_CATEGORIES:
            objective.set_rating(category, None)
        objective.mov = None
    db.session.commit()
    return jsonify({"reset": True, "scope": scope, "year": year}), 200


# ---------------------------------------------------------------------------
# EOPCRF4 -- Part IV: Improvement and Development Plans
#
# Four routes: read everything on the page (six fixed plan rows -- three in
# Part IV-A, three in Part IV-B -- plus the two Feedback boxes), patch a
# single row, save a Feedback box, and reset. There's no create/delete for
# rows -- see models.py's EOPCRF4Row docstring for why they're permanent
# slots, and why "top 5" ranking/label resolution for Part IV-B's Strengths
# / Improvement Needs picks is left to eopcrf4.js instead of computed here.
# ---------------------------------------------------------------------------
_EOPCRF4_TEXT_FIELDS = {
    # JSON key -> model attribute
    "gapAnalysis": "gap_analysis",
    "improvementArea": "improvement_area",
    "objective": "objective",
    "intervention": "intervention",
    "timeline": "timeline",
    "resources": "resources",
}
_EOPCRF4_REF_FIELDS = {
    "strengthRef": "strength_ref",
    "devNeedsRef": "dev_needs_ref",
}


@app.route("/irc/eopcrf4/data", methods=["GET"])
def get_eopcrf4_data():
    year = request.args.get("year", type=int) or _current_year()

    existing = {(r.part, r.position): r for r in EOPCRF4Row.query.filter_by(year=year).all()}
    added = False
    for part in EOPCRF4_PARTS:
        for position in EOPCRF4_POSITIONS:
            if (part, position) not in existing:
                row = EOPCRF4Row(year=year, part=part, position=position, is_locked=True)
                db.session.add(row)
                existing[(part, position)] = row
                added = True
    if added:
        db.session.commit()

    rows = [existing[(part, position)].to_dict() for part in EOPCRF4_PARTS for position in EOPCRF4_POSITIONS]

    feedback = {part: "" for part in EOPCRF4_PARTS}
    for fb in EOPCRF4Feedback.query.filter_by(year=year).all():
        if fb.part in feedback:
            feedback[fb.part] = fb.text or ""

    return jsonify({"year": year, "rows": rows, "feedback": feedback}), 200


@app.route("/irc/eopcrf4/row", methods=["POST"])
def save_eopcrf4_row():
    """Partial update of one fixed plan row. Every field is optional -- only
    keys present in the body are changed, so the dropdown picks, the text
    cells, and the lock toggle can each be saved independently without
    clobbering the others.

    Expected JSON body (all fields but 'part' and 'position' optional):
        {
          "year": 2026, "part": "B", "position": 1,
          "strengthRef": "o:17", "devNeedsRef": "c:self_management",
          "gapAnalysis": "...", "improvementArea": "...",
          "objective": "...", "intervention": "...",
          "timeline": "...", "resources": "...",
          "isLocked": true
        }
    gapAnalysis / improvementArea are Part IV-A columns; strengthRef /
    devNeedsRef are Part IV-B columns. Sending one for the wrong part is
    rejected rather than silently stored.
    """
    data = request.get_json(silent=True) or {}
    year = data.get("year") or _current_year()
    part = data.get("part")
    position = data.get("position")

    if part not in EOPCRF4_PARTS:
        return jsonify({"error": f"Invalid part: {part!r}"}), 400
    if position not in EOPCRF4_POSITIONS:
        return jsonify({"error": f"Invalid position: {position!r}"}), 400
    if part == "A" and any(k in data for k in _EOPCRF4_REF_FIELDS):
        return jsonify({"error": "Part IV-A has no Strengths / Improvement Needs picks"}), 400
    if part == "B" and ("gapAnalysis" in data or "improvementArea" in data):
        return jsonify({"error": "Part IV-B has no Gap Analysis / Improvement Area columns"}), 400

    row = EOPCRF4Row.query.filter_by(year=year, part=part, position=position).first()
    if row is None:
        row = EOPCRF4Row(year=year, part=part, position=position, is_locked=True)
        db.session.add(row)

    for key, attr in _EOPCRF4_REF_FIELDS.items():
        if key in data:
            setattr(row, attr, str(data[key]) if data[key] not in (None, "") else None)
    for key, attr in _EOPCRF4_TEXT_FIELDS.items():
        if key in data:
            setattr(row, attr, (data.get(key) or "").strip() or None)
    if "isLocked" in data:
        row.is_locked = bool(data["isLocked"])

    db.session.commit()
    return jsonify(row.to_dict()), 200


@app.route("/irc/eopcrf4/feedback", methods=["POST"])
def save_eopcrf4_feedback():
    """Saves one 'Feedback:' box. Expected JSON body:
        { "year": 2026, "part": "A", "text": "..." }
    Empty text clears the box."""
    data = request.get_json(silent=True) or {}
    year = data.get("year") or _current_year()
    part = data.get("part")

    if part not in EOPCRF4_PARTS:
        return jsonify({"error": f"Invalid part: {part!r}"}), 400
    if data.get("text") is not None and not isinstance(data["text"], str):
        return jsonify({"error": "'text' must be a string"}), 400

    fb = EOPCRF4Feedback.query.filter_by(year=year, part=part).first()
    if fb is None:
        fb = EOPCRF4Feedback(year=year, part=part)
        db.session.add(fb)
    fb.text = (data.get("text") or "").strip() or None

    db.session.commit()
    return jsonify({"year": year, "part": part, "text": fb.text or ""}), 200


@app.route("/irc/eopcrf4/reset", methods=["DELETE"])
def reset_eopcrf4_data():
    """Clears every plan row for the given year back to blank and locked,
    and empties both Feedback boxes. The six rows themselves are fixed
    slots so they're never deleted here, only their editable fields.
    eopcrf4.js just re-fetches everything via loadAll() afterward, so no
    scope/body is needed in the response beyond a success flag."""
    year = request.args.get("year", type=int) or _current_year()

    for row in EOPCRF4Row.query.filter_by(year=year).all():
        row.gap_analysis = None
        row.improvement_area = None
        row.strength_ref = None
        row.dev_needs_ref = None
        row.objective = None
        row.intervention = None
        row.timeline = None
        row.resources = None
        row.is_locked = True

    EOPCRF4Feedback.query.filter_by(year=year).delete()

    db.session.commit()
    return jsonify({"reset": True, "year": year}), 200


# ---------------------------------------------------------------------------
# EOPCRF3 -- Part III: Summary of Ratings. Read-only, has no routes of its
# own: eopcrf3.js reads EOPCRF1's data (/irc/eopcrf1/data), EOPCRF2's data
# (/irc/eopcrf2/data) and EOPCRF1's report header
# (/api/eopcrf1/report-header) directly, since there's nothing
# EOPCRF3-specific to store.
# ---------------------------------------------------------------------------


@app.errorhandler(404)
def not_found(e):
    return render_template("404.html", tabs=TABS, active_tab=None), 404


if __name__ == "__main__":
    # Convenience for local dev: make sure the schema exists even if
    # `flask init-db` was never run. In production/packaged builds, prefer
    # running the CLI command explicitly once during setup instead of
    # relying on this.
    with app.app_context():
        db.create_all()
        _ensure_eopcrf1_schema()
        _ensure_eopcrf2_schema()
    app.run(debug=True)