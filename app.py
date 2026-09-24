import os
import sys
from datetime import datetime
from flask import Flask, render_template, abort, request, jsonify
from sqlalchemy import event
from sqlalchemy.engine import Engine

from models import (
    db,
    IRC8BRating,
    IRC8AKra,
    IRC8AObjective,
    IRC8AIndicator,
    IRC8A_CATEGORIES,
    IRC8CRow,
    IRC8C_SLOTS,
    ReportPreparer,
    IRC8AApprovingAuthority,
    IRC8AReportHeader,
    ReportSignatoryDate,
    IRC8B_SECTION_CBC,
    IRC8B_SECTION_CS,
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


@app.cli.command("init-db")
def init_db_command():
    """Usage: flask --app app init-db
    Creates all tables (if missing). Safe to run more than once."""
    with app.app_context():
        db.create_all()
        print(f"Database ready at {app.config['SQLALCHEMY_DATABASE_URI']}")


# ---------------------------------------------------------------------------
# Fixed list of tabs. This system has exactly 4 Individual Report Cards
# (IRC8a-8d, the IPCRF series) and this list will not grow.
# ---------------------------------------------------------------------------
TABS = [
    {"id": "irc8a", "short": "EOPCRF I", "part": "Part I", "name": "EOPCRF Part I", "desc": "Individual Performance Commitment and Review Form (IPCRF)"},
    {"id": "irc8b", "short": "EOPCRF II", "part": "Part II", "name": "EOPCRF Part II", "desc": "Core Behavioral Competencies and Core Skills"},
    {"id": "irc8c", "short": "EOPCRF III", "part": "Part III", "name": "EOPCRF Part III", "desc": "Summary of Ratings for Discussion"},
    {"id": "irc8d", "short": "EOPCRF IV", "part": "Part IV", "name": "EOPCRF Part IV", "desc": "Summary of Ratings for Discussion (Read-Only Summary)"},
]

# Quick lookup by id, e.g. TAB_LOOKUP["irc8a"]
TAB_LOOKUP = {tab["id"]: tab for tab in TABS}

# Each tab renders its own template file under templates/tabs/, since every
# report card has its own structure/functionality. E.g. "irc8a" -> "tabs/irc8a.html"
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


def _get_irc8a_approving_authority():
    """Single global row holding IRC8A's 'Approving Authority' name (see
    IRC8AApprovingAuthority in models.py). Created lazily with a blank name
    on first access, same convention as _get_preparer() above."""
    authority = IRC8AApprovingAuthority.query.first()
    if authority is None:
        authority = IRC8AApprovingAuthority(name="")
        db.session.add(authority)
        db.session.commit()
    return authority


def _get_irc8a_report_header():
    """Single global row holding IRC8A's printed-report header fields (see
    IRC8AReportHeader in models.py). Created lazily with blank fields on
    first access, same convention as _get_preparer() /
    _get_irc8a_approving_authority() above."""
    header = IRC8AReportHeader.query.first()
    if header is None:
        header = IRC8AReportHeader()
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


@app.route("/api/irc8a/approving-authority", methods=["GET"])
def get_irc8a_approving_authority():
    """Read-only fetch used by base.html's report-signatory footer, on the
    IRC8A page only, to fill in the current 'Approving Authority' name."""
    authority = _get_irc8a_approving_authority()
    return jsonify({"name": authority.name}), 200


@app.route("/api/irc8a/approving-authority", methods=["POST"])
def save_irc8a_approving_authority():
    """Saves the 'Approving Authority' name typed directly in IRC8A's
    report-signatory footer. Single global row -- not year-scoped and
    intentionally untouched by IRC8A's Reset."""
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()

    authority = _get_irc8a_approving_authority()
    authority.name = name
    db.session.commit()

    return jsonify({"name": authority.name}), 200


@app.route("/api/irc8a/report-header", methods=["GET"])
def get_irc8a_report_header():
    """Read-only fetch used by irc8a.js to fill in the printed-report
    header fields (Name of Rater/Employee, their Positions, Bureau/Center/
    Service/Division, Rating Period, Date of Review) shown at the top of
    the IRC8A page and reproduced in its Save-to-PDF output."""
    header = _get_irc8a_report_header()
    return jsonify(header.to_dict()), 200


@app.route("/api/irc8a/report-header", methods=["POST"])
def save_irc8a_report_header():
    """Saves IRC8A's printed-report header fields, typed directly on the
    IRC8A page. Single global row -- not year-scoped and intentionally
    untouched by IRC8A's Reset. Accepts a partial body -- any field
    omitted is left as-is rather than cleared, so each input can save
    independently on blur without clobbering the others."""
    data = request.get_json(silent=True) or {}
    header = _get_irc8a_report_header()

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
    Approving Authority on irc8a only)."""
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
    populating the page client-side (see irc8a.js, irc8b.js, irc8c.js,
    irc8d.js)."""
    active_tab = TAB_LOOKUP.get(tab_id)
    if active_tab is None:
        abort(404)
    return render_template(TEMPLATE_MAP[tab_id], tabs=TABS, active_tab=active_tab)


# ---------------------------------------------------------------------------
# IRC8b -- Core Behavioral Competencies and Core Skills
# ---------------------------------------------------------------------------
@app.route("/irc/irc8b/data", methods=["GET"])
def get_irc8b_data():
    year = request.args.get("year", type=int) or _current_year()
    rows = IRC8BRating.query.filter_by(year=year).all()

    ratings = {}
    for row in rows:
        ratings.setdefault(row.subsection_key, {})[str(row.criterion_index)] = row.rating

    return jsonify({"year": year, "ratings": ratings}), 200


@app.route("/irc/irc8b/rating", methods=["POST"])
def save_irc8b_rating():
    """Expected JSON body:
        { "year": 2026, "sectionKey": "cbc", "subsectionKey": "self_management",
          "criterionIndex": 0, "rating": 4 }

    'rating' may be null/omitted to clear a previously-set rating --
    irc8b.js does this when the user clicks an already-selected button.
    """
    data = request.get_json(silent=True) or {}
    year = data.get("year") or _current_year()
    section_key = data.get("sectionKey")
    subsection_key = data.get("subsectionKey")
    criterion_index = data.get("criterionIndex")
    rating = data.get("rating")

    if section_key not in (IRC8B_SECTION_CBC, IRC8B_SECTION_CS):
        return jsonify({"error": f"Invalid sectionKey: {section_key!r}"}), 400
    if not subsection_key or criterion_index is None:
        return jsonify({"error": "'subsectionKey' and 'criterionIndex' are required"}), 400
    if rating is not None and rating not in (1, 2, 3, 4, 5):
        return jsonify({"error": f"Invalid rating: {rating!r}"}), 400

    row = IRC8BRating.query.filter_by(
        year=year, subsection_key=subsection_key, criterion_index=criterion_index
    ).first()
    if row is None:
        row = IRC8BRating(year=year, subsection_key=subsection_key, criterion_index=criterion_index)
        db.session.add(row)
    row.section_key = section_key
    row.rating = rating
    db.session.commit()

    return jsonify({
        "year": year,
        "sectionKey": section_key,
        "subsectionKey": subsection_key,
        "criterionIndex": criterion_index,
        "rating": rating,
    }), 200


# ---------------------------------------------------------------------------
# IRC8a -- Individual Performance Commitment and Review Form (IPCRF)
#
# These routes just persist whatever the KRA / Objective / rubric-indicator
# modals in irc8a.js submit. See the IRC8A* section of models.py for the
# full rationale behind the KRA -> Objective -> Indicator shape.
# ---------------------------------------------------------------------------
def _validate_weight(raw):
    """Returns (weight_or_None, error_message_or_None). Mirrors irc8a.js's
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


@app.route("/irc/irc8a/data", methods=["GET"])
def get_irc8a_data():
    year = request.args.get("year", type=int) or _current_year()
    kras = (
        IRC8AKra.query.filter_by(year=year)
        .order_by(IRC8AKra.sort_order.asc(), IRC8AKra.id.asc())
        .all()
    )
    return jsonify({"year": year, "kras": [k.to_dict() for k in kras]}), 200


@app.route("/irc/irc8a/kra", methods=["POST"])
def save_irc8a_kra():
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
        kra = IRC8AKra.query.get(kra_id)
        if kra is None:
            return jsonify({"error": "KRA not found"}), 404
    else:
        year = data.get("year") or _current_year()
        max_order = db.session.query(db.func.max(IRC8AKra.sort_order)).filter_by(year=year).scalar() or 0
        kra = IRC8AKra(year=year, sort_order=max_order + 1)
        db.session.add(kra)

    kra.text = text
    kra.weight = weight
    db.session.commit()
    return jsonify(kra.to_dict()), 200


@app.route("/irc/irc8a/kra/<int:kra_id>", methods=["DELETE"])
def delete_irc8a_kra(kra_id):
    kra = IRC8AKra.query.get(kra_id)
    if kra is None:
        return jsonify({"error": "KRA not found"}), 404
    db.session.delete(kra)  # cascades to its objectives and their indicators
    db.session.commit()
    return jsonify({"deleted": True, "id": kra_id}), 200


@app.route("/irc/irc8a/objective", methods=["POST"])
def save_irc8a_objective():
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
        objective = IRC8AObjective.query.get(obj_id)
        if objective is None:
            return jsonify({"error": "Objective not found"}), 404
    else:
        kra_id = data.get("kraId")
        kra = IRC8AKra.query.get(kra_id) if kra_id else None
        if kra is None:
            return jsonify({"error": "KRA not found"}), 404
        max_order = (
            db.session.query(db.func.max(IRC8AObjective.sort_order))
            .filter_by(kra_id=kra.id).scalar() or 0
        )
        objective = IRC8AObjective(kra_id=kra.id, sort_order=max_order + 1)
        db.session.add(objective)

    objective.text = text
    objective.weight = weight
    db.session.commit()
    return jsonify(objective.to_dict()), 200


@app.route("/irc/irc8a/objective/<int:obj_id>", methods=["DELETE"])
def delete_irc8a_objective(obj_id):
    objective = IRC8AObjective.query.get(obj_id)
    if objective is None:
        return jsonify({"error": "Objective not found"}), 404
    db.session.delete(objective)  # cascades to its rubric indicators
    db.session.commit()
    return jsonify({"deleted": True, "id": obj_id}), 200


@app.route("/irc/irc8a/objective/<int:obj_id>/mov", methods=["POST"])
def save_irc8a_objective_mov(obj_id):
    """Expected JSON body: { "url": "https://..." }
    An empty/omitted url clears the MOV link, matching irc8a.js's
    delete-mov action."""
    objective = IRC8AObjective.query.get(obj_id)
    if objective is None:
        return jsonify({"error": "Objective not found"}), 404

    data = request.get_json(silent=True) or {}
    url = (data.get("url") or "").strip()
    objective.mov = url or None
    db.session.commit()
    return jsonify(objective.to_dict()), 200


@app.route("/irc/irc8a/objective/<int:obj_id>/actual-results", methods=["POST"])
def save_irc8a_objective_actual_results(obj_id):
    """Expected JSON body: { "text": "..." }"""
    objective = IRC8AObjective.query.get(obj_id)
    if objective is None:
        return jsonify({"error": "Objective not found"}), 404

    data = request.get_json(silent=True) or {}
    objective.actual_results = (data.get("text") or "").strip() or None
    db.session.commit()
    return jsonify(objective.to_dict()), 200


@app.route("/irc/irc8a/objective/<int:obj_id>/timeline", methods=["POST"])
def save_irc8a_objective_timeline(obj_id):
    """Expected JSON body: { "text": "..." }"""
    objective = IRC8AObjective.query.get(obj_id)
    if objective is None:
        return jsonify({"error": "Objective not found"}), 404

    data = request.get_json(silent=True) or {}
    objective.timeline = (data.get("text") or "").strip() or None
    db.session.commit()
    return jsonify(objective.to_dict()), 200


@app.route("/irc/irc8a/objective/<int:obj_id>/rating", methods=["POST"])
def save_irc8a_objective_rating(obj_id):
    """Sets (or clears) one category's selected rating on an objective --
    fired both by clicking a rubric indicator (select-indicator) and by
    picking a value directly from that category's dropdown.

    Expected JSON body: { "category": "quality", "rating": 4 }
    'rating' may be null/omitted to clear it."""
    objective = IRC8AObjective.query.get(obj_id)
    if objective is None:
        return jsonify({"error": "Objective not found"}), 404

    data = request.get_json(silent=True) or {}
    category = data.get("category")
    rating = data.get("rating")

    if category not in IRC8A_CATEGORIES:
        return jsonify({"error": f"Invalid category: {category!r}"}), 400
    if rating is not None and rating not in (1, 2, 3, 4, 5):
        return jsonify({"error": f"Invalid rating: {rating!r}"}), 400

    objective.set_rating(category, rating)
    db.session.commit()
    return jsonify(objective.to_dict()), 200


@app.route("/irc/irc8a/indicator", methods=["POST"])
def save_irc8a_indicator():
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
        indicator = IRC8AIndicator.query.get(indicator_id)
        if indicator is None:
            return jsonify({"error": "Indicator not found"}), 404
        objective_id = indicator.objective_id
        category = indicator.category  # fixed at creation
    else:
        indicator = None
        objective_id = data.get("objectiveId")
        category = data.get("category")
        if category not in IRC8A_CATEGORIES:
            return jsonify({"error": f"Invalid category: {category!r}"}), 400
        objective = IRC8AObjective.query.get(objective_id) if objective_id else None
        if objective is None:
            return jsonify({"error": "Objective not found"}), 404
        if len(objective.indicators_for(category)) >= 5:
            return jsonify({"error": "At most 5 indicators are allowed per category."}), 400

    # Dupe check runs before the new row is added to the session (and
    # before any field is set on an existing one), so autoflush never
    # tries to insert/update a half-filled row while this query runs.
    dupe_query = IRC8AIndicator.query.filter_by(
        objective_id=objective_id, category=category, rate=rate
    )
    if indicator_id:
        dupe_query = dupe_query.filter(IRC8AIndicator.id != indicator_id)
    if dupe_query.first() is not None:
        return jsonify({"error": f"Rating level {rate} is already used for this category."}), 400

    if indicator is None:
        indicator = IRC8AIndicator(objective_id=objective_id, category=category)
        db.session.add(indicator)

    indicator.rate = rate
    indicator.label = label
    db.session.commit()
    return jsonify(indicator.to_dict()), 200


@app.route("/irc/irc8a/indicator/<int:indicator_id>", methods=["DELETE"])
def delete_irc8a_indicator(indicator_id):
    indicator = IRC8AIndicator.query.get(indicator_id)
    if indicator is None:
        return jsonify({"error": "Indicator not found"}), 404
    db.session.delete(indicator)
    db.session.commit()
    return jsonify({"deleted": True, "id": indicator_id}), 200


@app.route("/irc/irc8a/reset", methods=["DELETE"])
def reset_irc8a_data():
    """Two reset scopes for the "Reset All Data" button/modal, chosen via
    ?scope=ratings_mov|all (defaults to "ratings_mov"). irc8a.js reads the
    returned "scope" back to decide whether to clear ratings in place or
    drop every KRA client-side.

      - scope=ratings_mov (default): clears every objective's three
        ratings (quality/efficiency/timeliness) and its MOV link for the
        given year -- the "Clear ratings & MOV links only" option. KRAs,
        objectives, weights, rubric indicators, timeline, and actual
        results are left completely untouched.

      - scope=all: the "Reset entire form" option. Deletes every KRA for
        the given year outright, which cascades to delete its objectives
        and their rubric indicators too.
    """
    scope = request.args.get("scope", "ratings_mov")
    year = request.args.get("year", type=int) or _current_year()

    if scope == "all":
        IRC8AKra.query.filter_by(year=year).delete()
        db.session.commit()
        return jsonify({"reset": True, "scope": "all", "year": year}), 200

    objectives = (
        IRC8AObjective.query.join(IRC8AKra, IRC8AObjective.kra_id == IRC8AKra.id)
        .filter(IRC8AKra.year == year)
        .all()
    )
    for objective in objectives:
        for category in IRC8A_CATEGORIES:
            objective.set_rating(category, None)
        objective.mov = None
    db.session.commit()
    return jsonify({"reset": True, "scope": "ratings_mov", "year": year}), 200


# ---------------------------------------------------------------------------
# IRC8c -- Summary of Ratings for Discussion
#
# Just two routes: one to read the (always-exactly-four) Development Plan
# rows plus the live Final Rating, one to patch a single row. There's no
# create/delete here -- see models.py's IRC8CRow docstring for why the four
# rows are permanent slots rather than a user-managed list, and why
# "top 5" ranking/label resolution is left to irc8c.js instead of computed
# here (short version: IRC8b's subsection titles and per-subsection
# criteria only exist in irc8b.js, so IRC8c's route can't resolve an
# irc8b_* ref into a label without duplicating that list here too).
# ---------------------------------------------------------------------------
@app.route("/irc/irc8c/data", methods=["GET"])
def get_irc8c_data():
    year = request.args.get("year", type=int) or _current_year()

    existing = {r.slot: r for r in IRC8CRow.query.filter_by(year=year).all()}
    added = False
    for slot in IRC8C_SLOTS:
        if slot not in existing:
            row = IRC8CRow(year=year, slot=slot, is_locked=True)
            db.session.add(row)
            existing[slot] = row
            added = True
    if added:
        db.session.commit()

    rows = [existing[slot].to_dict() for slot in IRC8C_SLOTS]

    # Final Performance Results Rating = sum of every objective's Score
    # (Average x Weight) for the year -- the same arithmetic irc8a.js's
    # summary footer uses, just computed here via IRC8AObjective.score()
    # so IRC8c never has to re-derive it (or store a stale copy).
    objectives = (
        IRC8AObjective.query.join(IRC8AKra, IRC8AObjective.kra_id == IRC8AKra.id)
        .filter(IRC8AKra.year == year)
        .all()
    )
    scores = [s for s in (o.score() for o in objectives) if s is not None]
    final_rating = sum(scores) if scores else None

    return jsonify({"year": year, "finalRating": final_rating, "rows": rows}), 200


@app.route("/irc/irc8c/row", methods=["POST"])
def save_irc8c_row():
    """Partial update of one fixed Development Plan row. Every field is
    optional -- only keys present in the body are changed, so the dropdown
    picks, the text cells, and the lock toggle can each be saved
    independently without clobbering the others.

    Expected JSON body (all fields but 'slot' optional):
        {
          "year": 2026, "slot": "irc8a_1",
          "strengthRef": "17", "devNeedsRef": "42",
          "actionPlan": "...", "timeline": "...", "resourcesNeeded": "...",
          "isLocked": true
        }
    """
    data = request.get_json(silent=True) or {}
    year = data.get("year") or _current_year()
    slot = data.get("slot")

    if slot not in IRC8C_SLOTS:
        return jsonify({"error": f"Invalid slot: {slot!r}"}), 400

    row = IRC8CRow.query.filter_by(year=year, slot=slot).first()
    if row is None:
        row = IRC8CRow(year=year, slot=slot, is_locked=True)
        db.session.add(row)

    if "strengthRef" in data:
        row.strength_ref = str(data["strengthRef"]) if data["strengthRef"] not in (None, "") else None
    if "devNeedsRef" in data:
        row.dev_needs_ref = str(data["devNeedsRef"]) if data["devNeedsRef"] not in (None, "") else None
    if "actionPlan" in data:
        row.action_plan = (data.get("actionPlan") or "").strip() or None
    if "timeline" in data:
        row.timeline = (data.get("timeline") or "").strip() or None
    if "resourcesNeeded" in data:
        row.resources_needed = (data.get("resourcesNeeded") or "").strip() or None
    if "isLocked" in data:
        row.is_locked = bool(data["isLocked"])

    db.session.commit()
    return jsonify(row.to_dict()), 200


@app.route("/irc/irc8c/reset", methods=["DELETE"])
def reset_irc8c_data():
    """Clears every Development Plan row for the given year back to blank
    and locked. The four rows themselves are fixed slots (see IRC8C_SLOTS
    / IRC8CRow) so they're never deleted here, only their editable fields.
    irc8c.js just re-fetches everything via loadAll() afterward, so no
    scope/body is needed in the response beyond a success flag."""
    year = request.args.get("year", type=int) or _current_year()

    rows = IRC8CRow.query.filter_by(year=year).all()
    for row in rows:
        row.strength_ref = None
        row.dev_needs_ref = None
        row.action_plan = None
        row.timeline = None
        row.resources_needed = None
        row.is_locked = True

    db.session.commit()
    return jsonify({"reset": True, "year": year}), 200


# ---------------------------------------------------------------------------
# IRC8d -- read-only, has no routes of its own: irc8d.js hits IRC8a's own
# data endpoint (/irc/irc8a/data) directly, since there's nothing
# IRC8d-specific to store -- it's a pure read-only view of whatever's
# currently on IRC8a.
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
    app.run(debug=True)
