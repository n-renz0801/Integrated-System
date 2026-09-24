"""
EOPCRF_SH -- Database Models
=============================
SQLAlchemy models for this app's four tabs -- IRC8a (IPCRF), IRC8b (Core
Behavioral Competencies and Core Skills), IRC8c (Summary of Ratings for
Discussion / Development Plans), and IRC8d (read-only summary of IRC8a) --
plus the shared "who's signing this report" tables used by every page's
report-signatory footer.

This is a trimmed-down sibling of a larger sister project (SGOD PMES) that
covered 13 report cards; only the IRC8-series models made the cut here, so
there is no `UploadedFile` table and nothing carries an `uploaded_file_id`
column -- every row in this app is typed in by hand through the tab's own
UI, there is no PDF-import pipeline at all.

Design notes
------------
* `year` lives on every table that can meaningfully repeat annually (KRAs,
  ratings, development-plan rows), so the schema is already multi-year even
  though the current UI only shows one year at a time.

* Cascade deletion (KRA -> Objective -> Indicator) is wired two ways so it
  holds up no matter how a row gets deleted later:
    1. DB-level: `ondelete="CASCADE"` on the FK column + `passive_deletes=True`
       on the relationship. This requires SQLite's `PRAGMA foreign_keys=ON`,
       which app.py turns on for every connection.
    2. ORM-level: `cascade="all, delete-orphan"` on the relationship, so
       `db.session.delete(kra)` cleans up its objectives/indicators even
       before the DB-level pragma is considered.
"""

from datetime import datetime

from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()

IRC8B_SECTION_CBC = "cbc"
IRC8B_SECTION_CS = "cs"

IRC8A_CATEGORY_QUALITY = "quality"
IRC8A_CATEGORY_EFFICIENCY = "efficiency"
IRC8A_CATEGORY_TIMELINESS = "timeliness"
IRC8A_CATEGORIES = (IRC8A_CATEGORY_QUALITY, IRC8A_CATEGORY_EFFICIENCY, IRC8A_CATEGORY_TIMELINESS)

# The Development Plans table on IRC8c has exactly four fixed rows -- two
# fed by IRC8a (Key Result Areas/Objectives) and two fed by IRC8b (Core
# Behavioral Competencies/Core Skills subsections) -- rather than a
# user-managed add/delete list. "_1"/"_2" gives each source two
# independent picks (e.g. two different strong objectives) rather than
# forcing everything into one row per source.
IRC8C_SLOT_IRC8A_1 = "irc8a_1"
IRC8C_SLOT_IRC8A_2 = "irc8a_2"
IRC8C_SLOT_IRC8B_1 = "irc8b_1"
IRC8C_SLOT_IRC8B_2 = "irc8b_2"
IRC8C_SLOTS = (IRC8C_SLOT_IRC8A_1, IRC8C_SLOT_IRC8A_2, IRC8C_SLOT_IRC8B_1, IRC8C_SLOT_IRC8B_2)


# ---------------------------------------------------------------------------
# IRC8b -- Core Behavioral Competencies and Core Skills
#
# The sections/subsections/criteria text is hardcoded in irc8b.js (DATA
# constant) -- only the numbers the user picks are persisted here, one row
# per (year, subsection, criterion index).
# ---------------------------------------------------------------------------
class IRC8BRating(db.Model):
    __tablename__ = "irc8b_ratings"
    __table_args__ = (
        db.UniqueConstraint("year", "subsection_key", "criterion_index", name="uq_irc8b_year_subsection_criterion"),
    )

    id = db.Column(db.Integer, primary_key=True)

    year = db.Column(db.Integer, nullable=False, index=True)
    section_key = db.Column(db.String(10), nullable=False)      # IRC8B_SECTION_CBC | IRC8B_SECTION_CS
    subsection_key = db.Column(db.String(40), nullable=False)   # e.g. "self_management"
    criterion_index = db.Column(db.Integer, nullable=False)     # 0-based position within the subsection's criteria

    rating = db.Column(db.Integer, nullable=True)  # 1-5, or NULL if cleared

    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ---------------------------------------------------------------------------
# IRC8a -- Individual Performance Commitment and Review Form (IPCRF)
#
# The KRA -> Objective -> rubric-indicator hierarchy from irc8a.js maps
# onto three tables:
#
#   IRC8AKra        -- one row per Key Result Area. `year` lives here (the
#                       top of the tree) since the whole IPCRF is an annual
#                       document; nothing below repeats it.
#   IRC8AObjective  -- one row per Objective under a KRA. Carries the
#                       Planning fields (timeline) and Evaluation fields
#                       (MOV link, actual results, and the three per-
#                       category ratings) directly as columns, since each
#                       objective has exactly one of each.
#   IRC8AIndicator  -- one row per rubric line ("what earns a 3" etc.)
#                       under one of an objective's three categories
#                       (quality/efficiency/timeliness). irc8a.js caps
#                       these at 5 per category with a unique rate 1-5
#                       each, enforced here via the unique constraint below.
#
# `rating_quality` / `rating_efficiency` / `rating_timeliness` on
# IRC8AObjective are the *selected* rating for that category -- set either
# by clicking a rubric indicator or picking a value directly from that
# category's dropdown. They are stored independently of IRC8AIndicator:
# deleting a rubric indicator never clears a rating that happens to match
# its rate, since the rating may have been set manually too.
#
# The overall Average (per objective) and Score (Average x Objective
# Weight), and the KRA-list-wide Total KRA Weight / Overall Rating summary,
# are all cheap to recompute from the columns above on every read, so none
# of them are persisted.
# ---------------------------------------------------------------------------
class IRC8AKra(db.Model):
    __tablename__ = "irc8a_kras"

    id = db.Column(db.Integer, primary_key=True)

    year = db.Column(db.Integer, nullable=False, index=True)
    text = db.Column(db.Text, nullable=False, default="")
    weight = db.Column(db.Float, nullable=True)  # percent, 0-100

    # Preserves on-screen KRA order (also drives the palette color cycle
    # and the "Key Result Area N" numbering in irc8a.js) -- assigned as
    # max(sort_order)+1 at creation time; there's no drag-reorder in the
    # current UI, so nothing else ever rewrites it.
    sort_order = db.Column(db.Integer, nullable=False, default=0)

    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    objectives = db.relationship(
        "IRC8AObjective", backref="kra",
        cascade="all, delete-orphan", passive_deletes=True,
        order_by="IRC8AObjective.sort_order",
    )

    def to_dict(self):
        return {
            "id": self.id,
            "year": self.year,
            "text": self.text,
            "weight": self.weight,
            "objectives": [o.to_dict() for o in self.objectives],
        }


class IRC8AObjective(db.Model):
    __tablename__ = "irc8a_objectives"

    id = db.Column(db.Integer, primary_key=True)
    kra_id = db.Column(db.Integer, db.ForeignKey("irc8a_kras.id", ondelete="CASCADE"), nullable=False)

    text = db.Column(db.Text, nullable=False, default="")
    weight = db.Column(db.Float, nullable=True)  # percent, 0-100

    # Planning
    timeline = db.Column(db.Text, nullable=True)

    # Evaluation
    mov = db.Column(db.String(2000), nullable=True)   # Means of Verification link
    actual_results = db.Column(db.Text, nullable=True)

    # Selected rating per category -- independent of IRC8AIndicator, see
    # the module-level docstring above for why.
    rating_quality = db.Column(db.Integer, nullable=True)      # 1-5
    rating_efficiency = db.Column(db.Integer, nullable=True)   # 1-5
    rating_timeliness = db.Column(db.Integer, nullable=True)   # 1-5

    # Preserves on-screen order within its KRA -- drives the "Objective A/B/C..."
    # lettering (letterLabel(objIndex) in irc8a.js) by position, not by id.
    sort_order = db.Column(db.Integer, nullable=False, default=0)

    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    indicators = db.relationship(
        "IRC8AIndicator", backref="objective",
        cascade="all, delete-orphan", passive_deletes=True,
    )

    _RATING_COLUMNS = {
        IRC8A_CATEGORY_QUALITY: "rating_quality",
        IRC8A_CATEGORY_EFFICIENCY: "rating_efficiency",
        IRC8A_CATEGORY_TIMELINESS: "rating_timeliness",
    }

    def rating_for(self, category):
        return getattr(self, self._RATING_COLUMNS[category], None)

    def set_rating(self, category, value):
        setattr(self, self._RATING_COLUMNS[category], value)

    def indicators_for(self, category):
        # Sorted highest rate first, matching irc8a.js's renderIndicatorGroup.
        return sorted(
            (i for i in self.indicators if i.category == category),
            key=lambda i: i.rate,
            reverse=True,
        )

    def average(self):
        values = [
            v for v in (self.rating_quality, self.rating_efficiency, self.rating_timeliness)
            if v is not None
        ]
        if not values:
            return None
        return sum(values) / len(values)

    def score(self):
        avg = self.average()
        if avg is None or self.weight is None:
            return None
        return avg * (self.weight / 100)

    def to_dict(self):
        return {
            "id": self.id,
            "kraId": self.kra_id,
            "text": self.text,
            "weight": self.weight,
            "timeline": self.timeline,
            "mov": self.mov,
            "actualResults": self.actual_results,
            "ratings": {
                IRC8A_CATEGORY_QUALITY: self.rating_quality,
                IRC8A_CATEGORY_EFFICIENCY: self.rating_efficiency,
                IRC8A_CATEGORY_TIMELINESS: self.rating_timeliness,
            },
            "average": self.average(),
            "score": self.score(),
            IRC8A_CATEGORY_QUALITY: [i.to_dict() for i in self.indicators_for(IRC8A_CATEGORY_QUALITY)],
            IRC8A_CATEGORY_EFFICIENCY: [i.to_dict() for i in self.indicators_for(IRC8A_CATEGORY_EFFICIENCY)],
            IRC8A_CATEGORY_TIMELINESS: [i.to_dict() for i in self.indicators_for(IRC8A_CATEGORY_TIMELINESS)],
        }


class IRC8AIndicator(db.Model):
    """One rubric line ("what earns this rating level") under one of an
    objective's three Planning categories. irc8a.js caps these at 5 per
    (objective, category) with a unique rate 1-5 each -- enforced here too."""

    __tablename__ = "irc8a_indicators"
    __table_args__ = (
        db.UniqueConstraint("objective_id", "category", "rate", name="uq_irc8a_objective_category_rate"),
    )

    id = db.Column(db.Integer, primary_key=True)
    objective_id = db.Column(db.Integer, db.ForeignKey("irc8a_objectives.id", ondelete="CASCADE"), nullable=False)

    category = db.Column(db.String(12), nullable=False)  # IRC8A_CATEGORY_*
    rate = db.Column(db.Integer, nullable=False)          # 1-5
    label = db.Column(db.Text, nullable=False, default="")

    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "objectiveId": self.objective_id,
            "category": self.category,
            "rate": self.rate,
            "label": self.label,
        }


# ---------------------------------------------------------------------------
# IRC8c -- Summary of Ratings for Discussion
#
# One row per fixed slot (see IRC8C_SLOTS above) -- there's no add/delete
# here, just four permanent Development Plan entries the ratee and rater
# fill in together. "Strength" and "Development Need" aren't freehand text:
# they're a *pointer* to something already rated elsewhere --
#   - irc8a_1 / irc8a_2  -> strength_ref/dev_needs_ref hold the id of an
#     IRC8AObjective (as a string, so this column can hold either kind of
#     ref without a polymorphic FK)
#   - irc8b_1 / irc8b_2  -> they hold an IRC8b subsection key (e.g.
#     "self_management") -- IRC8b has no per-subsection DB row of its own
#     (subsection titles are hardcoded in irc8b.js), so the key is all
#     there is to reference.
#
# Deliberately NOT resolved/validated here: which objectives or subsections
# currently rank in the "top 5" is a moving target, and resolving a ref
# into a display label is left to irc8c.js, which already fetches
# /irc/irc8a/data and /irc/irc8b/data directly -- this table only
# remembers *which* ref the user picked.
#
# The Final Performance Results Rating shown on IRC8c is likewise not
# stored -- it's the live sum of every IRC8AObjective.score() for the
# year, computed fresh in the /irc/irc8c/data route.
# ---------------------------------------------------------------------------
class IRC8CRow(db.Model):
    __tablename__ = "irc8c_rows"
    __table_args__ = (
        db.UniqueConstraint("year", "slot", name="uq_irc8c_year_slot"),
    )

    id = db.Column(db.Integer, primary_key=True)

    year = db.Column(db.Integer, nullable=False, index=True)
    slot = db.Column(db.String(16), nullable=False)  # IRC8C_SLOTS

    # Ref into IRC8AObjective.id (irc8a_* slots) or an IRC8b subsection key
    # (irc8b_* slots) -- see class docstring. Left unvalidated against the
    # referenced table/list on purpose: the referenced objective/subsection
    # can outlive or outrank its way out of the top-5, and the UI just
    # shows "no longer available" rather than silently clearing the pick.
    strength_ref = db.Column(db.String(64), nullable=True)
    dev_needs_ref = db.Column(db.String(64), nullable=True)

    action_plan = db.Column(db.Text, nullable=True)
    timeline = db.Column(db.Text, nullable=True)
    resources_needed = db.Column(db.Text, nullable=True)

    # Action Plan / Timeline / Resources Needed all share one lock: the
    # single edit-toggle button in the row's Actions column unlocks (and
    # re-locks + saves) all three together, rather than each cell having
    # its own toggle.
    is_locked = db.Column(db.Boolean, nullable=False, default=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "year": self.year,
            "slot": self.slot,
            "source": "irc8a" if self.slot.startswith("irc8a") else "irc8b",
            "strengthRef": self.strength_ref,
            "devNeedsRef": self.dev_needs_ref,
            "actionPlan": self.action_plan,
            "timeline": self.timeline,
            "resourcesNeeded": self.resources_needed,
            "isLocked": self.is_locked,
        }


# ---------------------------------------------------------------------------
# Shared "who's signing this report" tables -- used by base.html's
# report-signatory footer (Prepared by / Checked by / Approving Authority)
# on every tab.
# ---------------------------------------------------------------------------
class ReportPreparer(db.Model):
    """Single global row holding the 'Prepared by' name/position, typed in
    on the Home page and shown at the bottom of every tab. Not year-scoped,
    and never touched by any tab's Reset -- it's signatory identity, not
    report data."""

    __tablename__ = "report_preparer"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(255), nullable=False, default="")
    position = db.Column(db.String(255), nullable=False, default="")

    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ---------------------------------------------------------------------------
# IRC8A's own third signatory -- "Approving Authority" name shown alongside
# "Prepared by"/"Checked by" in the report-signatory footer, but only on the
# IRC8A page itself (see base.html's active_tab.id == 'irc8a' check).
# Single global row, same pattern as ReportPreparer above.
#
# Position ("Assistant Schools Division Superintendent") is NOT stored here
# -- like "Checked by", it's a fixed value hardcoded directly in base.html.
# ---------------------------------------------------------------------------
class IRC8AApprovingAuthority(db.Model):
    __tablename__ = "irc8a_approving_authority"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(255), nullable=False, default="")

    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ---------------------------------------------------------------------------
# IRC8A's printed-report header block -- the "Name of Rater / Position",
# "Name of Employee / Position", "Bureau/Center/Service/Division", and
# "Rating Period" / "Date of Review" fields that appear across the top of
# the official DEPED RPMS "Individual Performance Commitment and Review
# Form" (IPCRF) sheet. These are distinct from IRC8AApprovingAuthority and
# the report-signatory footer -- those are the *signature line* at the
# bottom of the form; this is the identifying header info at the top.
#
# Single global row, lazily created on first access -- not year-scoped, and
# never touched by IRC8A's own Reset, since this is identity/period
# metadata, not KRA/objective report data.
# ---------------------------------------------------------------------------
class IRC8AReportHeader(db.Model):
    __tablename__ = "irc8a_report_header"

    id = db.Column(db.Integer, primary_key=True)

    name_of_rater = db.Column(db.String(255), nullable=False, default="")
    position_of_rater = db.Column(db.String(255), nullable=False, default="")
    name_of_employee = db.Column(db.String(255), nullable=False, default="")
    position_of_employee = db.Column(db.String(255), nullable=False, default="")
    bureau = db.Column(db.String(255), nullable=False, default="")  # "Bureau/Center/Service/Division"
    rating_period = db.Column(db.String(255), nullable=False, default="")
    date_of_review = db.Column(db.Date, nullable=True)

    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        return {
            "nameOfRater": self.name_of_rater,
            "positionOfRater": self.position_of_rater,
            "nameOfEmployee": self.name_of_employee,
            "positionOfEmployee": self.position_of_employee,
            "bureau": self.bureau,
            "ratingPeriod": self.rating_period,
            "dateOfReview": self.date_of_review.isoformat() if self.date_of_review else None,
        }


# ---------------------------------------------------------------------------
# Date shown under each signatory's position in the report-signatory footer
# (see base.html), one calendar-picked date per (tab, role) pair -- e.g.
# irc8a's "Prepared by" date is independent of irc8b's, even though both
# pages show the same preparer name (see ReportPreparer above).
#
# role is one of SIGNATORY_ROLES in app.py: "prepared_by", "checked_by", or
# "approving_authority" (the last one only ever appears on irc8a). Not
# year-scoped and never touched by any tab's own Reset.
# ---------------------------------------------------------------------------
class ReportSignatoryDate(db.Model):
    __tablename__ = "report_signatory_date"

    id = db.Column(db.Integer, primary_key=True)
    tab_id = db.Column(db.String(20), nullable=False)
    role = db.Column(db.String(30), nullable=False)
    date = db.Column(db.Date, nullable=True)

    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        db.UniqueConstraint("tab_id", "role", name="uq_report_signatory_date_tab_role"),
    )
