"""
EOPCRF_SH -- Database Models
=============================
SQLAlchemy models for this app's four tabs -- EOPCRF1 (IPCRF), EOPCRF2 (Part II:
Leadership and Core Behavioural Competencies), EOPCRF3 (read-only Part III: Summary of Ratings), and EOPCRF4
(Part IV: Improvement and Development Plans) --
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

# EOPCRF2 (Part II) has two sections: II-A Leadership Competencies and
# II-B Core Behavioural Competencies.
EOPCRF2_SECTION_LEADERSHIP = "leadership"
EOPCRF2_SECTION_CBC = "cbc"

EOPCRF1_CATEGORY_QUALITY = "quality"
EOPCRF1_CATEGORY_EFFICIENCY = "efficiency"
EOPCRF1_CATEGORY_TIMELINESS = "timeliness"
EOPCRF1_CATEGORIES = (EOPCRF1_CATEGORY_QUALITY, EOPCRF1_CATEGORY_EFFICIENCY, EOPCRF1_CATEGORY_TIMELINESS)

# EOPCRF1 is split into the three sub-parts of the official OPCRF/IPCRF
# Annex B form. Part I-A and Part I-C are the office's fixed, pre-defined
# structure (KRAs/Objectives come from the Compendium of Office Functions
# and never get added/edited/deleted by a user -- only rated). Part I-B is
# the "Innovating and Intervening Accomplishments" section, which is fully
# user-managed (this is what the original single-part EOPCRF1 already did
# before this split). See `part` on EOPCRF1Kra below and the "locked KRA"
# guards in app.py's KRA/Objective/Indicator routes.
EOPCRF1_PART_A = "a"
EOPCRF1_PART_B = "b"
EOPCRF1_PART_C = "c"
EOPCRF1_PARTS = (EOPCRF1_PART_A, EOPCRF1_PART_B, EOPCRF1_PART_C)

EOPCRF1_PART_LABELS = {
    EOPCRF1_PART_A: "Part I-A: Commitment to Organizational Outcomes",
    EOPCRF1_PART_B: "Part I-B: Innovating and Intervening Accomplishments",
    EOPCRF1_PART_C: "Part I-C: Organizational Effectiveness",
}

# EOPCRF4 (Part IV: Improvement and Development Plans) has two tables -- Part
# IV-A (Office Improvement Plan) and Part IV-B (Individual Development Plan)
# -- each with exactly three fixed rows rather than a user-managed add/delete
# list, plus one Feedback box under each table.
EOPCRF4_PART_A = "A"
EOPCRF4_PART_B = "B"
EOPCRF4_PARTS = (EOPCRF4_PART_A, EOPCRF4_PART_B)
# Part IV-A keeps 3 fixed rows; Part IV-B has 4 (rows 1-2 draw their picks
# from EOPCRF I, rows 3-4 from EOPCRF II -- see eopcrf4.js).
EOPCRF4_POSITIONS_BY_PART = {EOPCRF4_PART_A: (1, 2, 3), EOPCRF4_PART_B: (1, 2, 3, 4)}
EOPCRF4_POSITIONS = (1, 2, 3, 4)  # union, kept for existing imports


# ---------------------------------------------------------------------------
# EOPCRF2 -- Part II: Leadership Competencies (II-A) and Core Behavioural
# Competencies (II-B)
#
# The sections/subsections/indicator text is hardcoded in eopcrf2.js (DATA
# constant) -- only what the user enters is persisted here, one row per
# (year, subsection, indicator index): the 1-5 rating and the
# "Remarks / Observations" text from the form.
# ---------------------------------------------------------------------------
class EOPCRF2Rating(db.Model):
    __tablename__ = "eopcrf2_ratings"
    __table_args__ = (
        db.UniqueConstraint("year", "subsection_key", "criterion_index", name="uq_eopcrf2_year_subsection_criterion"),
    )

    id = db.Column(db.Integer, primary_key=True)

    year = db.Column(db.Integer, nullable=False, index=True)
    section_key = db.Column(db.String(10), nullable=False)      # EOPCRF2_SECTION_LEADERSHIP | EOPCRF2_SECTION_CBC
    subsection_key = db.Column(db.String(40), nullable=False)   # e.g. "self_management"
    criterion_index = db.Column(db.Integer, nullable=False)     # 0-based position within the subsection's indicators

    rating = db.Column(db.Integer, nullable=True)  # 1-5, or NULL if cleared
    remarks = db.Column(db.Text, nullable=False, default="", server_default="")  # Remarks / Observations

    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ---------------------------------------------------------------------------
# EOPCRF1 -- Individual Performance Commitment and Review Form (IPCRF)
#
# The KRA -> Objective -> rubric-indicator hierarchy from eopcrf1.js maps
# onto three tables:
#
#   EOPCRF1Kra        -- one row per Key Result Area. `year` lives here (the
#                       top of the tree) since the whole IPCRF is an annual
#                       document; nothing below repeats it.
#   EOPCRF1Objective  -- one row per Objective under a KRA. Carries the
#                       Planning fields (timeline) and Evaluation fields
#                       (MOV link, actual results, and the three per-
#                       category ratings) directly as columns, since each
#                       objective has exactly one of each.
#   EOPCRF1Indicator  -- one row per rubric line ("what earns a 3" etc.)
#                       under one of an objective's three categories
#                       (quality/efficiency/timeliness). eopcrf1.js caps
#                       these at 5 per category with a unique rate 1-5
#                       each, enforced here via the unique constraint below.
#
# `rating_quality` / `rating_efficiency` / `rating_timeliness` on
# EOPCRF1Objective are the *selected* rating for that category -- set either
# by clicking a rubric indicator or picking a value directly from that
# category's dropdown. They are stored independently of EOPCRF1Indicator:
# deleting a rubric indicator never clears a rating that happens to match
# its rate, since the rating may have been set manually too.
#
# The overall Average (per objective) and Score (Average x Objective
# Weight), and the KRA-list-wide Total KRA Weight / Overall Rating summary,
# are all cheap to recompute from the columns above on every read, so none
# of them are persisted.
# ---------------------------------------------------------------------------
class EOPCRF1Kra(db.Model):
    __tablename__ = "eopcrf1_kras"

    id = db.Column(db.Integer, primary_key=True)

    year = db.Column(db.Integer, nullable=False, index=True)
    text = db.Column(db.Text, nullable=False, default="")
    weight = db.Column(db.Float, nullable=True)  # percent, 0-100

    # "Organizational Outcomes Alignment" columns from the OPCRF sheet. One
    # set per KRA (every objective under the KRA shares them). Seeded for
    # Part I-A, optional free text for user-built Part I-B KRAs.
    gaa_program = db.Column(db.Text, nullable=True)     # GAA Programs / Subprograms
    bedp_pillars = db.Column(db.Text, nullable=True)    # BEDP Pillars
    admin_agenda = db.Column(db.Text, nullable=True)    # Current Administration Agenda

    # Which of the three OPCRF sub-parts this KRA belongs to. Defaults to
    # "b" (the user-managed part) so every KRA created the old way, before
    # this column existed, keeps behaving exactly as it did. "a" and "c"
    # KRAs are seeded once per year by seed_eopcrf1_defaults() below and
    # are structurally locked -- see the `locked` property.
    part = db.Column(db.String(1), nullable=False, default=EOPCRF1_PART_B, index=True)

    # Preserves on-screen KRA order (also drives the palette color cycle
    # and the "Key Result Area N" numbering in eopcrf1.js) -- assigned as
    # max(sort_order)+1 at creation time; there's no drag-reorder in the
    # current UI, so nothing else ever rewrites it.
    sort_order = db.Column(db.Integer, nullable=False, default=0)

    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    objectives = db.relationship(
        "EOPCRF1Objective", backref="kra",
        cascade="all, delete-orphan", passive_deletes=True,
        order_by="EOPCRF1Objective.sort_order",
    )

    @property
    def locked(self):
        """True for Part I-A / Part I-C KRAs: their text/weight can't be
        edited and no KRA/Objective/Indicator can be added or removed
        under them -- only ratings (and the MOV/Actual Results/Timeline
        evaluation fields) can be filled in. Enforced server-side in
        app.py; this property is just what the frontend reads to decide
        which buttons to show."""
        return self.part != EOPCRF1_PART_B

    def to_dict(self):
        return {
            "id": self.id,
            "year": self.year,
            "text": self.text,
            "weight": self.weight,
            "gaaProgram": self.gaa_program,
            "bedpPillars": self.bedp_pillars,
            "adminAgenda": self.admin_agenda,
            "part": self.part,
            "locked": self.locked,
            "objectives": [o.to_dict() for o in self.objectives],
        }


class EOPCRF1Objective(db.Model):
    __tablename__ = "eopcrf1_objectives"

    id = db.Column(db.Integer, primary_key=True)
    kra_id = db.Column(db.Integer, db.ForeignKey("eopcrf1_kras.id", ondelete="CASCADE"), nullable=False)

    text = db.Column(db.Text, nullable=False, default="")
    weight = db.Column(db.Float, nullable=True)  # percent, 0-100

    # Planning
    timeline = db.Column(db.Text, nullable=True)
    target_value = db.Column(db.String(100), nullable=True)   # Performance Targets: Value (numerical, statistical, trend)
    target_description = db.Column(db.Text, nullable=True)    # Performance Targets: Description (expected outcome/output/service)
    mov_required = db.Column(db.Text, nullable=True)          # MOVs the form lists for this objective (document names)

    # Evaluation
    mov = db.Column(db.String(2000), nullable=True)   # Means of Verification link
    actual_results = db.Column(db.Text, nullable=True)

    # Selected rating per category -- independent of EOPCRF1Indicator, see
    # the module-level docstring above for why.
    rating_quality = db.Column(db.Integer, nullable=True)      # 1-5
    rating_efficiency = db.Column(db.Integer, nullable=True)   # 1-5
    rating_timeliness = db.Column(db.Integer, nullable=True)   # 1-5

    # Preserves on-screen order within its KRA -- drives the "Objective A/B/C..."
    # lettering (letterLabel(objIndex) in eopcrf1.js) by position, not by id.
    sort_order = db.Column(db.Integer, nullable=False, default=0)

    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    indicators = db.relationship(
        "EOPCRF1Indicator", backref="objective",
        cascade="all, delete-orphan", passive_deletes=True,
    )

    _RATING_COLUMNS = {
        EOPCRF1_CATEGORY_QUALITY: "rating_quality",
        EOPCRF1_CATEGORY_EFFICIENCY: "rating_efficiency",
        EOPCRF1_CATEGORY_TIMELINESS: "rating_timeliness",
    }

    def rating_for(self, category):
        return getattr(self, self._RATING_COLUMNS[category], None)

    def set_rating(self, category, value):
        setattr(self, self._RATING_COLUMNS[category], value)

    def indicators_for(self, category):
        # Sorted highest rate first, matching eopcrf1.js's renderIndicatorGroup.
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
            "targetValue": self.target_value,
            "targetDescription": self.target_description,
            "movRequired": self.mov_required,
            "mov": self.mov,
            "actualResults": self.actual_results,
            "ratings": {
                EOPCRF1_CATEGORY_QUALITY: self.rating_quality,
                EOPCRF1_CATEGORY_EFFICIENCY: self.rating_efficiency,
                EOPCRF1_CATEGORY_TIMELINESS: self.rating_timeliness,
            },
            "average": self.average(),
            "score": self.score(),
            EOPCRF1_CATEGORY_QUALITY: [i.to_dict() for i in self.indicators_for(EOPCRF1_CATEGORY_QUALITY)],
            EOPCRF1_CATEGORY_EFFICIENCY: [i.to_dict() for i in self.indicators_for(EOPCRF1_CATEGORY_EFFICIENCY)],
            EOPCRF1_CATEGORY_TIMELINESS: [i.to_dict() for i in self.indicators_for(EOPCRF1_CATEGORY_TIMELINESS)],
        }


class EOPCRF1Indicator(db.Model):
    """One rubric line ("what earns this rating level") under one of an
    objective's three Planning categories. eopcrf1.js caps these at 5 per
    (objective, category) with a unique rate 1-5 each -- enforced here too."""

    __tablename__ = "eopcrf1_indicators"
    __table_args__ = (
        db.UniqueConstraint("objective_id", "category", "rate", name="uq_eopcrf1_objective_category_rate"),
    )

    id = db.Column(db.Integer, primary_key=True)
    objective_id = db.Column(db.Integer, db.ForeignKey("eopcrf1_objectives.id", ondelete="CASCADE"), nullable=False)

    category = db.Column(db.String(12), nullable=False)  # EOPCRF1_CATEGORY_*
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
# Fixed Part I-A / Part I-C structure -- copied verbatim from the Annex B
# OPCRF sheet (part_1_format.pdf). Nothing below is reworded: objective
# text, KRA names, Weight Allocation per objective, and every rubric
# line (the 5-4-3-2-1 Quality / Efficiency / Timeliness indicators) are
# exactly as printed in the PDF, including its own typos (e.g. "81-86%",
# "learning-friendy"). Every line is the full cell text from the PDF.
#
# Each objective's "indicators" are seeded as EOPCRF1Indicator rows, so
# they show up as the clickable rubric lines on the page. Part I-A and
# Part I-C are locked (see EOPCRF1Kra.locked) so these can't be edited or
# deleted from the UI -- raters just click the level that applies.
#
# Weight Allocation checks (asserted at import time below):
#   Part I-A: 10 + 13 + 20 + 10 + 7 = 60      Part I-C: 5 + 5 + 5 = 15
# ---------------------------------------------------------------------------
EOPCRF1_SEED_KRAS = [
    {"part": EOPCRF1_PART_A, "text": "Leading Strategically (School Leadership and Administration)", "weight": 10, "objectives": [
        {
            "text": "1.2. Develop and implement with the planning team school plans aligned with institutional goals and policies",
            "weight": 3,
            "indicators": {
                "quality": {
                    5: "Developed SIP with the school planning team and presented to the division planning team was approved for implementation",
                    4: "Presented to the division planning team the developed SIP for appraisal and quality assurance",
                    3: "Developed with the planning team the SIP aligned with institutional goals and policies of the DEDP",
                    2: "Gathered relevant data for the crafting of the SIP with school personnel",
                    1: "Constituted the members of the school planning team",
                },
                "efficiency": {
                    5: "96-100% of SIP components and annexes are presented",
                    4: "91-95% of SIP components and annexes are presented",
                    3: "86-90% of SIP components and annexes are presented",
                    2: "81-85% of SIP components and annexes are presented",
                    1: "80% and below of SIP components and annexes are presented",
                },
                "timeliness": {
                    5: "Submission was done within the scheduled date",
                    4: "Submission was done 1-2 days after the scheduled date",
                    3: "Submission was done 3-4 days after the scheduled date",
                    2: "Submission was done 5-6 days after the scheduled date",
                    1: "Submission was done more than 6 days after the scheduled date",
                },
            },
        },
        {
            "text": "1.5. Implement programs in the school that support the development of learners",
            "weight": 4,
            "indicators": {
                "quality": {
                    5: "Evaluated the implementation of PPAs in the school AIP that support the development of learners as basis for school action planning",
                    4: "Monitored the implementation of PPAs in the school AIP that support the development of learners",
                    3: "Implemented PPAs in the school AIP that support the development of learners",
                    2: "Developed PPAs in the school AIP",
                    1: "Received proposed PPAs to be included in the school AIP",
                },
                "efficiency": {
                    5: "96-100% of school's strategic plan from SIP were operationalized into PPAs",
                    4: "91-95% of school's strategic plan from SIP were operationalized into PPAs",
                    3: "86-90% of school's strategic plan from SIP were operationalized into PPAs",
                    2: "81-86% of school's strategic plan from SIP were operationalized into PPAs",
                    1: "80% and below of school's strategic plan from SIP were operationalized into PPAs",
                },
                "timeliness": {
                    5: "Submission was done within the scheduled date",
                    4: "Submission was done 1-2 days after the scheduled date",
                    3: "Submission was done 3-4 days after the scheduled date",
                    2: "Submission was done 5-6 days after the scheduled date",
                    1: "Submission was done more than 6 days after the scheduled date",
                },
            },
        },
        {
            "text": "1.7. Utilize available monitoring and evaluation processes and tools to promote learner achievement",
            "weight": 3,
            "indicators": {
                "quality": {
                    5: "Evaluated and analyzed the monitoring and evaluation (M&E) results of implemented school PPAs that utilized M&E processes and tools as basis for school action planning",
                    4: "Consolidated the M&E results of implemented school PPAs that utilized M&E processes and tools to promote learner achievement",
                    3: "Utilized M&E processes and tools to promote learner achievement and school PPAs",
                    2: "Developed tools for the M&E of school PPAs",
                    1: "Assigned committees for the M&E of school PPAs",
                },
                "efficiency": {
                    5: "96-100% PPAs were implemented with M&E requirements",
                    4: "91-95% PPAs were implemented with M&E requirements",
                    3: "86-90% PPAs were implemented with M&E requirements",
                    2: "81-86% PPAs were implemented with M&E requirements",
                    1: "80% and below PPAs were implemented with M&E requirements",
                },
                "timeliness": {
                    5: "Submission was done within the scheduled date",
                    4: "Submission was done 1-2 days after the scheduled date",
                    3: "Submission was done 3-4 days after the scheduled date",
                    2: "Submission was done 5-6 days after the scheduled date",
                    1: "Submission was done more than 6 days after the scheduled date",
                },
            },
        },
    ]},
    {"part": EOPCRF1_PART_A, "text": "Managing School Operations and Resources (School Operations and Management)", "weight": 13, "objectives": [
        {
            "text": "2.1. Manage school data and information using technology, including ICT, to ensure efficient and effective school operations",
            "weight": 3,
            "indicators": {
                "quality": {
                    5: "Evaluated and analyzed the school data and information (LIS, EBEIS, SFs, SFCR) for dissemination and utilization to ensure efficient and effective school operations",
                    4: "Monitored the management school data and information (LIS, EBEIS, SFs, SFCR) to ensure efficient and effective school operations",
                    3: "Managed school data and information (LIS, EBEIS, SFs, SFCR) to ensure efficient and effective school operations",
                    2: "Consolidated school data and information using data collection tools",
                    1: "Gathered school data and information using data collection tools",
                },
                "efficiency": {
                    5: "96-100% of EMIS and records action were complied and acted upon (e.g. LIS, EBEIS, SFs, SFCR)",
                    4: "91-95% of EMIS and records action were complied and acted upon (e.g. LIS, EBEIS, SFs, SFCR)",
                    3: "86-90% of EMIS and records action were complied and acted upon (e.g. LIS, EBEIS, SFs, SFCR)",
                    2: "81-85% of EMIS and records action were complied and acted upon (e.g. LIS, EBEIS, SFs, SFCR)",
                    1: "80% and below of EMIS and records action were complied and acted upon (e.g. LIS, EBEIS, SFs, SFCR)",
                },
                "timeliness": {
                    5: "EMIS and records action were complied within the prescribed period",
                    4: "EMIS and records action were complied 1-2 days after the prescribed period",
                    3: "EMIS and records action were complied 3-4 days after the prescribed period",
                    2: "EMIS and records actions were complied 5-6 days after the prescribed period",
                    1: "EMIS and records actions were complied more than 6 days after the prescribed period",
                },
            },
        },
        {
            "text": "2.3. Manage school facilities and equipment in adherence to policies, guidelines and issuances on acquisition, recording, utilization, repair and maintenance, storage and disposal",
            "weight": 3,
            "indicators": {
                "quality": {
                    5: "Evaluated and analyzed the status of school facilities, equipment and supplies in adherence to policies, guidelines and issuances on acquisition, recording, utilization, repair and maintenance, storage and disposal as basis for action planning",
                    4: "Monitored the school facilities, equipment and supplies in adherence to policies, guidelines and issuances on acquisition, recording, utilization, repair and maintenance, storage and disposal",
                    3: "Managed school facilities, equipment and supplies in adherence to policies, guidelines and issuances on acquisition, recording, utilization, repair and maintenance, storage and disposal",
                    2: "Maintained an inventory of school facilities, equipment and supplies",
                    1: "Kept proofs of acceptance of school facilities, equipment and supplies",
                },
                "efficiency": {
                    5: "96-100% of school properties are accounted in updated inventory",
                    4: "91-95% of school properties are accounted in updated inventory",
                    3: "86-90% of school properties are accounted in updated inventory",
                    2: "81-85% of school properties are accounted in updated inventory",
                    1: "80% and below of school properties are accounted in updated inventory",
                },
                "timeliness": {
                    5: "Inventory reports were submitted within the schedule",
                    4: "Inventory reports were submitted 1-2 days after the schedule",
                    3: "Inventory reports were submitted 3-4 days after the schedule",
                    2: "Inventory reports were submitted 5-6 days after the schedule",
                    1: "Inventory reports were submitted more than 6 days after the schedule",
                },
            },
        },
        {
            "text": "2.5. Manage school safety for disaster preparedness, mitigation and resiliency to ensure continuous delivery of instruction",
            "weight": 3,
            "indicators": {
                "quality": {
                    5: "Evaluated and analyzed the status of school safety for disaster preparedness, mitigation and resiliency to ensure continuous delivery of instruction as reflected in the school DRRM contingency plans",
                    4: "Monitored the implementation of school safety for disaster preparedness, mitigation and resiliency to ensure continuous delivery of instruction",
                    3: "Managed school safety for disaster preparedness, mitigation and resiliency to ensure continuous delivery of instruction",
                    2: "Gathered relevant data for the crafting of contingency plans with the school DRRM teams",
                    1: "Constituted the members of the school DRRM teams",
                },
                "efficiency": {
                    5: "96-100% of DRRM PPAs were implemented and monitored",
                    4: "91-95% of DRRM PPAs were implemented and monitored",
                    3: "86-90% of DRRM PPAs were implemented and monitored",
                    2: "81-85% of DRRM PPAs were implemented and monitored",
                    1: "80% and below of DRRM PPAs were implemented and monitored",
                },
                "timeliness": {
                    5: "Reports were submitted within the scheduled date",
                    4: "Reports were submitted 1-2 days after the scheduled date",
                    3: "Reports were submitted 3-4 days after the scheduled date",
                    2: "Reports were submitted 5-6 days after the scheduled date",
                    1: "Reports were submitted more than 6 days after the scheduled date",
                },
            },
        },
        {
            "text": "2.6. Manage emerging opportunities and challenges to encourage equality and equity in addressing the needs of learners, school personnel and other stakeholders",
            "weight": 4,
            "indicators": {
                "quality": {
                    5: "Evaluated and analyzed the status of emerging opportunities and challenges to encourage equality and equity in addressing the needs of learners, school personnel and other stakeholders (Save LARDOS, Sports, Youth Formation, Child Protection Policy, Guidance Services)",
                    4: "Monitored the emerging opportunities and challenges to encourage equality and equity in addressing the needs of learners, school personnel and other stakeholders (Save LARDOS, Sports, Youth Formation, Child Protection Policy, Guidance Services)",
                    3: "Managed emerging opportunities and challenges to encourage equality and equity in addressing the needs of learners, school personnel and other stakeholders (Save LARDOS, Sports, Youth Formation, Child Protection Policy, Guidance Services)",
                    2: "Gathered relevant data for the crafting of programs, projects and activities for learner support services",
                    1: "Designated school coordinators for learner support services",
                },
                "efficiency": {
                    5: "96-100% of learner support PPAs were implemented and monitored",
                    4: "91-95% of learner support PPAs were implemented and monitored",
                    3: "86-90% of learner support PPAs were implemented and monitored",
                    2: "81-85% of learner support PPAs were implemented and monitored",
                    1: "80% and below of learner support PPAs were implemented and monitored",
                },
                "timeliness": {
                    5: "Reports were submitted within the scheduled date",
                    4: "Reports were submitted 1-2 days after the scheduled date",
                    3: "Reports were submitted 3-4 days after the scheduled date",
                    2: "Reports were submitted 5-6 days after the scheduled date",
                    1: "Reports were submitted more than 6 days after the scheduled date",
                },
            },
        },
    ]},
    {"part": EOPCRF1_PART_A, "text": "Focusing on Teaching and Learning (Teaching and Learning Delivery)", "weight": 20, "objectives": [
        {
            "text": "3.2. Provide technical assistance to teachers on teaching standards and pedagogies within and across learning areas to improve their teaching practice",
            "weight": 7,
            "indicators": {
                "quality": {
                    5: "Evaluated and analyzed the status of the provision of TA and IS to teachers on teaching standards and pedagogies within and across learning areas to improve their teaching practice as basis for L&D activities",
                    4: "Monitored the status of the provided TA and IS to teachers on teaching standards and pedagogies within and across learning areas to improve their teaching practice based on the agreement forms and/or COTs",
                    3: "Provided TA and IS to teachers on teaching standards and pedagogies within and across learning areas to improve their teaching practice",
                    2: "Crafted the SSIS and the IS and TA plans",
                    1: "Designated TA providers to teachers",
                },
                "efficiency": {
                    5: "96-100% of teachers were provided with technical assistance and instructional supervision",
                    4: "91-95% of teachers were provided with technical assistance and instructional supervision",
                    3: "86-90% of teachers were provided with technical assistance and instructional supervision",
                    2: "81-85% of teachers were provided with technical assistance and instructional supervision",
                    1: "80% and below of teachers were provided with technical assistance and instructional supervision",
                },
                "timeliness": {
                    5: "Reports were submitted within the scheduled date",
                    4: "Reports were submitted 1-2 days after the scheduled date",
                    3: "Reports were submitted 3-4 days after the scheduled date",
                    2: "Reports were submitted 5-6 days after the scheduled date",
                    1: "Reports were submitted more than 6 days after the scheduled date",
                },
            },
        },
        {
            "text": "3.4. Utilize learning outcomes in developing data-based interventions to maintain learner achievement and attain other performance indicators",
            "weight": 7,
            "indicators": {
                "quality": {
                    5: "Evaluated and analyzed the learning outcomes assessment (LOA) results and implemented data-based interventions to maintain learner achievement and attain other performance indicators",
                    4: "Monitored the implementation of data-based interventions based on LOA results to maintain learner achievement and attain other performance indicators",
                    3: "Utilized LOA results in developing data-based interventions to maintain learner achievement and attain other performance indicators",
                    2: "Consolidated LOA results in all grade levels and learning areas",
                    1: "Gather LOA results in all grade levels and learning areas",
                },
                "efficiency": {
                    5: "Attained LOA results higher than the school's overall target by more than 0.5%",
                    4: "Attained LOA results higher than the school's overall target by 0.01-0.5%",
                    3: "Attained LOA results that meet the school's overall target",
                    2: "Attained LOA results below the school's overall target by 0.01-0.5%",
                    1: "Attained LOA results below the school's overall target by more than 0.5%",
                },
                "timeliness": {
                    5: "Submitted the LOA report within the scheduled date",
                    4: "Submitted the LOA report 1-2 days after the scheduled date",
                    3: "Submitted the LOA report 3-4 days after the scheduled date",
                    2: "Submitted the LOA report 5-6 days after the scheduled date",
                    1: "Submitted the LOA report more than 5 days after the scheduled date",
                },
            },
        },
        {
            "text": "3.6. Manage a learning-friendy, inclusive and healthy learning environment through effective learning resource management",
            "weight": 3,
            "indicators": {
                "quality": {
                    5: "Evaluated and analyzed the status of learner-friendly, inclusive and healthy learning environment through effective learning resource management as basis for action planning",
                    4: "Monitored the learner-friendly, inclusive and healthy learning environment through effective learning resource management",
                    3: "Managed a learning-friendy, inclusive and healthy learning environment through effective learning resource management",
                    2: "Established a school learning resource center",
                    1: "Maintained an inventory of learning resources in the school",
                },
                "efficiency": {
                    5: "96-100% of available learning resources were distributed and utilized",
                    4: "91-95% of available learning resources were distributed and utilized",
                    3: "86-90% of available learning resources were distributed and utilized",
                    2: "81-85% of available learning resources were distributed and utilized",
                    1: "96-100% of available learning resources were distributed and utilized",
                },
                "timeliness": {
                    5: "Reports were submitted within the scheduled date",
                    4: "Reports were submitted 1-2 days after the scheduled date",
                    3: "Reports were submitted 3-4 days after the scheduled date",
                    2: "Reports were submitted 5-6 days after the scheduled date",
                    1: "Reports were submitted more than 6 days after the scheduled date",
                },
            },
        },
        {
            "text": "3.7. Ensure integration of career awareness and opportunities in the provision of learning experiences aligned with the curriculum",
            "weight": 3,
            "indicators": {
                "quality": {
                    5: "Evaluated and analyzed the integration of career awareness and opportunities in the provision of learning experiences aligned with the curriculum (co-curricular activities)",
                    4: "Monitored the integration of career awareness and opportunities in the provision of learning experiences aligned with the curriculum (co-curricular activities)",
                    3: "Ensured the integration of career awareness and opportunities in the provision of learning experiences aligned with the curriculum (co-curricular activities)",
                    2: "Crafted plans for the conduct of co-curricular activities in the school",
                    1: "Assigned committees for the conduct of co-curricular activities in the school",
                },
                "efficiency": {
                    5: "96-100% of curriculum support PPAs were conducted and monitored",
                    4: "91-95% of curriculum support PPAs were conducted and monitored",
                    3: "86-90% of curriculum support PPAs were conducted and monitored",
                    2: "81-85% of curriculum support PPAs were conducted and monitored",
                    1: "80% and below of curriculum support PPAs were conducted and monitored",
                },
                "timeliness": {
                    5: "Reports were submitted within the scheduled date",
                    4: "Reports were submitted 1-2 days after the scheduled date",
                    3: "Reports were submitted 3-4 days after the scheduled date",
                    2: "Reports were submitted 5-6 days after the scheduled date",
                    1: "Reports were submitted more than 6 days after the scheduled date",
                },
            },
        },
    ]},
    {"part": EOPCRF1_PART_A, "text": "Developing Self and Others (School Operations and Management)", "weight": 10, "objectives": [
        {
            "text": "4.4. Implement the performance management system with a team to support the career advancement of school personnel, and to improve office performance",
            "weight": 4,
            "indicators": {
                "quality": {
                    5: "Evaluated and analyzed the implementation of RPMS with a team to support career advancement of school personnel and to improve office performance as basis for performance planning in the next rating period",
                    4: "Monitored the implementation of RPMS with a team to support the career advancement of school personnel and to improve office performance",
                    3: "Implemented the RPMS with a team to support the career advancement of school personnel, and to improve office performance",
                    2: "Oriented the school personnel on the implementation of RPMS",
                    1: "Constituted the school performance management team (PMT)",
                },
                "efficiency": {
                    5: "96-100% of employees have undergone the performance management cycle",
                    4: "91-95% of employees have undergone the performance management cycle",
                    3: "86-90% of employees have undergone the performance management cycle",
                    2: "81-85% of employees have undergone the performance management cycle",
                    1: "80% and below of employees have undergone the performance management cycle",
                },
                "timeliness": {
                    5: "Signed PCRFs submitted within the schedule",
                    4: "Signed PCRFs submitted 1-2 days after the schedule",
                    3: "Signed PCRFs submitted 3-4 days after the schedule",
                    2: "Signed PCRFs submitted 5-6 days after the schedule",
                    1: "Signed PCRFs submitted more than 6 days after the schedule",
                },
            },
        },
        {
            "text": "4.5. Implement professional development initiatives to enhance strengths and address performance gaps among school personnel",
            "weight": 4,
            "indicators": {
                "quality": {
                    5: "Evaluated and analyzed the implementation of professional development initiatives to enhance strengths and address performance gaps among school personnel as basis for development planning",
                    4: "Monitored the implementation of professional development initiatives to enhance strengths and address performance gaps among school personnel",
                    3: "Implemented professional development initiatives to enhance strengths and address performance gaps among school personnel",
                    2: "Crafted plans and proposals for the conduct of L&D activities",
                    1: "Designated school coordinator and teams for L&D activities",
                },
                "efficiency": {
                    5: "96-100% of school personnel participated in school-initiated learning and development (L&D) activities",
                    4: "91-95% of school personnel participated in school-initiated L&D activities",
                    3: "86-90% of school personnel participated in school-initiated L&D activities",
                    2: "81-85% of school personnel participated in school-initiated L&D activities",
                    1: "80% and below of school personnel participated in school-initiated L&D activities",
                },
                "timeliness": {
                    5: "Approved training proposals and accomplishment reports were submitted within the schedule",
                    4: "Approved training proposals and accomplishment reports were submitted 1-2 days after the schedule",
                    3: "Approved training proposals and accomplishment reports were submitted 3-4 days after the schedule",
                    2: "Approved training proposals and accomplishment reports were submitted 5-6 days after the schedule",
                    1: "Approved training proposals and accomplishment reports were submitted more than 6 days after the schedule",
                },
            },
        },
        {
            "text": "4.7. Implement laws, policies, guidelines and issuances on the rights, privileges and benefits of school personnel to ensure their general welfare",
            "weight": 1,
            "indicators": {
                "quality": {
                    5: "Evaluated and analyzed the implementation of laws, policies, guidelines and issuances on the rights, privileges and benefits of school personnel to ensure their general welfare",
                    4: "Monitored the implementation of laws, policies, guidelines and issuances on the rights, privileges and benefits of school personnel to ensure their general welfare",
                    3: "Implemented laws, policies, guidelines and issuances on the rights, privileges and benefits of school personnel to ensure their general welfare",
                    2: "Personnel actions complied with revisions and corrections",
                    1: "Personnel actions have backlog and disapproval",
                },
                "efficiency": {
                    5: "96-100% of personnel action were complied and acted upon",
                    4: "91-95% of personnel action were complied and acted upon",
                    3: "86-90% of personnel action were complied and acted upon",
                    2: "81-85% of personnel action were complied and acted upon",
                    1: "80% and below of personnel action were complied and acted upon",
                },
                "timeliness": {
                    5: "Personnel action were complied within the prescribed period",
                    4: "Personnel action were complied 1-2 days after the prescribed period",
                    3: "Personnel action were complied 3-4 days after the prescribed period",
                    2: "Personnel action were complied 5-6 days after the prescribed period",
                    1: "Personnel action were complied more than 6 days after the prescribed period",
                },
            },
        },
        {
            "text": "4.8. Implement a school rewards system to recognize and motivate learners, school personnel and other stakeholders for exemplary performance and/or continued support",
            "weight": 1,
            "indicators": {
                "quality": {
                    5: "Evaluated and analyzed the school rewards system to recognize and motivate learners, school personnel and other stakeholders for exemplary performance and/or continued support as basis for action planning",
                    4: "Monitored the school rewards system to recognize and motivate learners, school personnel and other stakeholders for exemplary performance and/or continued support",
                    3: "Implemented a school rewards system to recognize and motivate learners, school personnel and other stakeholders for exemplary performance and/or continued support",
                    2: "Initiated the establishment of a rewards and recognition system",
                    1: "No rewards and recognition system established",
                },
                "efficiency": {
                    5: "96-100% of target awardees were recognized",
                    4: "91-95% of target awardees were recognized",
                    3: "86-90% of target awardees were recognized",
                    2: "81-85% of target awardees were recognized",
                    1: "80% and below of target awardees were recognized",
                },
                "timeliness": {
                    5: "Reports were submitted within the scheduled date",
                    4: "Reports were submitted 1-2 days after the scheduled date",
                    3: "Reports were submitted 3-4 days after the scheduled date",
                    2: "Reports were submitted 5-6 days after the scheduled date",
                    1: "Reports were submitted more than 6 days after the scheduled date",
                },
            },
        },
    ]},
    {"part": EOPCRF1_PART_A, "text": "Building Connections (Learner Formation and Development)", "weight": 7, "objectives": [
        {
            "text": "5.3. Exhibit inclusive practices such as gender sensitivity, physical and mental health awareness and culture responsiveness, to foster awareness, acceptance and respect",
            "weight": 3,
            "indicators": {
                "quality": {
                    5: "Evaluated and analyzed inclusive practices such as gender sensitivity, physical and mental health awareness and culture responsiveness, to foster awareness, acceptance and respect as basis for action planning",
                    4: "Monitored inclusive practices such as gender sensitivity, physical and mental health awareness and culture responsiveness, to foster awareness, acceptance and respect",
                    3: "Exhibited inclusive practices such as gender sensitivity, physical and mental health awareness and culture responsiveness, to foster awareness, acceptance and respect",
                    2: "Crafted plans and proposals for the conduct of GAD and school health activities",
                    1: "Designated school coordinators for GAD and school health activities",
                },
                "efficiency": {
                    5: "96-100% of GAD and school health PPAs were implemented and monitored",
                    4: "91-95% of GAD and school health PPAs were implemented and monitored",
                    3: "86-90% of GAD and school health PPAs were implemented and monitored",
                    2: "81-85% of GAD and school health PPAs were implemented and monitored",
                    1: "80% and below of learner support PPAs were implemented and monitored",
                },
                "timeliness": {
                    5: "Reports were submitted within the scheduled date",
                    4: "Reports were submitted 1-2 days after the scheduled date",
                    3: "Reports were submitted 3-4 days after the scheduled date",
                    2: "Reports were submitted 5-6 days after the scheduled date",
                    1: "Reports were submitted more than 6 days after the scheduled date",
                },
            },
        },
        {
            "text": "5.5. Initiate partnerships with the community, such as parents, alumni, authorities, industries and other stakeholders, to strengthen support for learner development, as well as school and community improvement",
            "weight": 4,
            "indicators": {
                "quality": {
                    5: "Evaluated and analyzed the partnerships with the community, such as parents, alumni, authorities, industries and other stakeholders, to strengthen support for learner development, as well as school and community improvement as basis for action planning",
                    4: "Monitored the status of partnerships with the community, such as parents, alumni, authorities, industries and other stakeholders, to strengthen support for learner development, as well as school and community improvement",
                    3: "Initiated partnerships with the community, such as parents, alumni, authorities, industries and other stakeholders, to strengthen support for learner development, as well as school and community improvement",
                    2: "Identified potential education partners to support school programs",
                    1: "No education partner identified",
                },
                "efficiency": {
                    5: "Established 7 or more partnership engagements with support documents",
                    4: "Established 5-6 partnership engagements with support documents",
                    3: "Established 3-4 partnership engagements with support documents",
                    2: "Established 2 partnership engagements with support documents",
                    1: "Established 1 partnership engagement with support documents",
                },
                "timeliness": {
                    5: "Reports and DPDS updated within the schedule",
                    4: "Reports and DPDS updated 1-2 days after the schedule",
                    3: "Reports and DPDS updated 3-4 days after the schedule",
                    2: "Reports and DPDS updated 5-6 days after the schedule",
                    1: "Reports and DPDS updated more than 6 days after the schedule",
                },
            },
        },
    ]},
    {"part": EOPCRF1_PART_C, "text": "Financial Stewardship", "weight": 5, "objectives": [
        {
            "text": "Utilized 98% of the budget allocation in accordance with the quarterly disbursement program with no overdraft/deficit/disallowance from oversight agency/ies",
            "weight": 5,
            "indicators": {
                "quality": {
                    5: "Budget allocation disbursed within the reglementary period with no overdraft/deficit/disallowance from oversight agency/ies",
                    4: "Budget allocation disbursed within the reglementary period with 1-2 overdraft/deficit/disallowance from oversight agency/ies",
                    3: "Budget allocation disbursed within the reglementary period with 3-4 overdraft/deficit/disallowance from oversight agency/ies",
                    2: "Budget allocation disbursed within the reglementary period with 5-6 overdraft/deficit/disallowance from oversight agency/ies",
                    1: "Budget allocation disbursed within the reglementary period with 7 or more overdraft/deficit/disallowance from oversight agency/ies",
                },
                "efficiency": {
                    5: "Budget is utilized according to the BUR target, based on the official BUR report of the Finance Service/Section/Unit (i.e. 98% of the budget allocation is utilized within the FY)",
                    4: "Budget is utilized with 1-5% variance from BUR target, based on the official BUR report of the Finance Service/Section/Unit (i.e. 93-97% of the budget allocation is utilized within the FY)",
                    3: "Budget is utilized with 6-10% variance from BUR target, based on the official BUR report of the Finance Service/Section/Unit (i.e. 88-92% of the budget allocation is utilized within the FY)",
                    2: "Budget is utilized with 11-15% variance from BUR target, based on the official BUR report of the Finance Service/Section/Unit (i.e. 83-87% of the budget allocation is utilized within the FY)",
                    1: "Budget is utilized with more than 15% variance from BUR target, based on the official BUR report of the Finance Service/Section/Unit (i.e. Below 83% of the budget allocation is utilized within the FY)",
                },
                "timeliness": {
                    5: "Quarterly basis:\nBudget is utilized according to the quarterly disbursement program (i.e. 98% of the quarterly BUR target is utilized by the end of each quarter)",
                    4: "Quarterly basis:\nBudget is utilized with 1-5% variance from the quarterly disbursement program (i.e. 93-97% of the quarterly BUR target is utilized by the end of each quarter)",
                    3: "Quarterly basis:\nBudget is utilized with 6-10% variance from the quarterly disbursement program (i.e. 88-92% of the quarterly BUR target is utilized by the end of each quarter)",
                    2: "Quarterly basis:\nBudget is utilized with 11-15% variance from the quarterly disbursement program (i.e. 83-87% of the quarterly BUR target is utilized by the end of each quarter)",
                    1: "Quarterly basis:\nBudget is utilized with more than 15% variance from the quarterly disbursement program (i.e. Below 83% of the quarterly BUR target is utilized by the end of each quarter)",
                },
            },
        },
    ]},
    {"part": EOPCRF1_PART_C, "text": "Process improvement", "weight": 5, "objectives": [
        {
            "text": "Streamlined core processes and management of service provisioning of frontline and other office deliverables to ensure ease of transations and/or digitalization/digitization",
            "weight": 5,
            "indicators": {
                "quality": {
                    5: "Improvements/reduction on all of the service standards\n1. no. of documentary requirements 2. total processing time 3. transaction cost 4. client steps/agency action steps\n5. no. of signatories",
                    4: "Improvements/reduction on 4 service standards\n1. no. of documentary requirements 2. total processing time 3. transaction cost 4. client steps/agency action steps\n5. no. of signatories",
                    3: "Improvements/reduction on 2-3 service standards\n1. no. of documentary requirements 2. total processing time 3. transaction cost 4. client steps/agency action steps\n5. no. of signatories",
                    2: "Improvements/reduction on 1 service standards\n1. no. of documentary requirements 2. total processing time 3. transaction cost 4. client steps/agency action steps\n5. no. of signatories",
                    1: "No change in no. of documentary requirements, total processing time, transaction cost, process steps, signatories",
                },
                "efficiency": {
                    5: "Streamlined and/or digitized all office core processes identified in the QMS planning documents",
                    4: "Streamlined and/or digitized 76-99% of the office core processes identified in the QMS planning documents",
                    3: "Streamlined and/or digitized 51-75% of the office core processes identified in the QMS planning documents",
                    2: "Streamlined and/or digitized 26-50% of the office core processes identified in the QMS planning documents",
                    1: "Streamlined and/or digitized 0-25% of the office core processes identified in the QMS planning documents",
                },
                "timeliness": {
                },
            },
        },
    ]},
    {"part": EOPCRF1_PART_C, "text": "Client Satisfaction", "weight": 5, "objectives": [
        {
            "text": "Achieved 100% resolution and compliance rate to #8888 and CCB complaints within the prescribed processing time (simple - 3 days; complex - 7 days; highly technical - 20 days) with at least Satisfactory overall average result on the Client Satisfaction Measurement",
            "weight": 5,
            "indicators": {
                "quality": {
                    5: "95.0% - 100% (Outstanding) overall average on the results of the Client Satisfaction Measurement (CSM)",
                    4: "90.9% - 94.9% (Very Satisfactory) overall average on the results of the CSM",
                    3: "80.0% - 89.9% (Satisfactory) overall average on the results of the CSM",
                    2: "60.0% - 79.9% (Fair) overall average on the results of the CSM",
                    1: "Below 60.0% (Poor) overall average on the results of the CSM",
                },
                "efficiency": {
                    5: "100% resolution and compliance rate to #8888 and CCB complaints",
                    4: "At least 80% resolution and compliance rate to #8888 and CCB complaints",
                    3: "At least 50% resolution and compliance rate to #8888 and CCB complaints",
                    2: "At least 1% resolution and compliance rate to #8888 and CCB complaints",
                    1: "0% resolution and compliance rate to #8888 and CCB complaints",
                },
                "timeliness": {
                    5: "Complaints acted upon and closed within prescribed processing time (simple - 3 days; complex - 7 days; highly technical -20 days)",
                    3: "Complaints are acted upon and closed with documented delays based on the prescribed processing time (simple - 3 days; complex - 7 days; highly technical - 20 days)",
                    1: "No complaint acted upon and resolved",
                },
            },
        },
    ]},
]

# Guard against a transcription slip: Part I-A must total 60% and Part I-C 15%,
# and each KRA's weight must equal the sum of its objectives' weights.
for _kra in EOPCRF1_SEED_KRAS:
    assert _kra["weight"] == sum(o["weight"] for o in _kra["objectives"]), _kra["text"]
assert sum(k["weight"] for k in EOPCRF1_SEED_KRAS if k["part"] == EOPCRF1_PART_A) == 60
assert sum(k["weight"] for k in EOPCRF1_SEED_KRAS if k["part"] == EOPCRF1_PART_C) == 15

# ---------------------------------------------------------------------------
# Part I-A / I-C columns that sit beside the rubric on the OPCRF sheet but are
# not part of it: the per-KRA "Organizational Outcomes Alignment" values and
# each objective's Performance Target (value + description) and listed MOVs.
# Indexed like EOPCRF1_SEED_KRAS (KRA index; KRA index + objective index) so
# the long seed list above stays untouched.
# ---------------------------------------------------------------------------
EOPCRF1_SEED_KRA_META = {
    0: {"gaa": "Basic Education Inputs Program",
        "bedp": "Access; Governance and Administration",
        "agenda": "Efficient and Supportive Governance Structure"},
    1: {"gaa": "Basic Education Inputs Program; Support to Schools and Learners",
        "bedp": "Access; Resilience and Well-being; Governance and Administration",
        "agenda": "Efficient and Supportive Governance Structure; Learners' Physical and Mental Well-being Protected"},
    2: {"gaa": "Support to Schools and Learners; Inclusive Education Program",
        "bedp": "Quality, Equity",
        "agenda": "High Performing Teachers; High Quality of Education"},
    3: {"gaa": "Support to Schools and Learners; Education Human Resource Development",
        "bedp": "Access; Governance and Administration",
        "agenda": "High Performing Teachers; Efficient and Supportive Governance Structure"},
    4: {"gaa": "Support to Schools and Learners",
        "bedp": "Access; Resilience and Well-being; Governance and Administration",
        "agenda": "Efficient and Supportive Governance Structure"},
}

EOPCRF1_SEED_OBJECTIVE_META = {
    (0, 0): {"value": "100%", "desc": "Developed and approved SIP",
             "mov": "Approved SIP, Complete SIP components and annexes based on DO 44, s. 2015"},
    (0, 1): {"value": "100%", "desc": "Aligned AIP and SIP",
             "mov": "Approved AIP, Realignment requests if any, Progress Monitoring Report Form based on DO 44, s. 2015"},
    (0, 2): {"value": "100%", "desc": "Monitored PPAs",
             "mov": "Accomplishment Reports per PPA with M&E results"},
    (1, 0): {"value": "100%", "desc": "Complied EMIS and records action",
             "mov": "LIS Updating, EBEIS Updating or GSP Uploading, SF 4, SF 5, SF 6, SFCR"},
    (1, 1): {"value": "100%", "desc": "Submitted inventory reports",
             "mov": "NSBI, Property/ICT Inventory Reports, Program of Works on repairs and maintenance, Building Cards, Procurement Documents, Distribution Lists"},
    (1, 2): {"value": "100%", "desc": "Implemented and monitored DRRM PPAs",
             "mov": "Approved DRRM Contingency Plans, DRRM Accomplishment Reports"},
    (1, 3): {"value": "100%", "desc": "Implemented and monitored learner support PPAs",
             "mov": "Learner Support Systems and Plans, Accomplishment Reports with M&E Results"},
    (2, 0): {"value": "100%", "desc": "Conducted TA and IS",
             "mov": "Supervisory Instructional Supervision Schedule (SSIS), IS and TA Plan, Agreement Forms, Accomplished Reports, COTs"},
    (2, 1): {"value": "0-1%", "desc": "Met the LOA targets",
             "mov": "LOA Results and Analysis by Learning Area"},
    (2, 2): {"value": "100%", "desc": "Managed learning resources",
             "mov": "LR Inventory, LR Monitoring and Utilization Report, Updated SF 3"},
    (2, 3): {"value": "100%", "desc": "Implemented and monitored curriculum support PPAs",
             "mov": "Approved Proposals, School Memorandum, Post-Program Reports with M&E, Accomplishment Reports"},
    (3, 0): {"value": "100%", "desc": "Implemented performance management system",
             "mov": "OPCRF/IPCRF with MOVs, Accomplished PMCFs, Summary of Ratings"},
    (3, 1): {"value": "100%", "desc": "Trained personnel",
             "mov": "Approved Proposals, School Memorandum, Post-Program Reports with M&E Results"},
    (3, 2): {"value": "100%", "desc": "Complied personnel action",
             "mov": "SF 7, Duly Signed Payroll, Released Salaries/Benefits, Records of Personnel Action (appointment, promotion, reclassification, etc.), Personnel-related documents such as DTR, Form 6, etc."},
    (3, 3): {"value": "100%", "desc": "Recognized individuals or groups",
             "mov": "Approved Proposal, School Memorandum, Accomplishment Reports with M&E Results, if applicable"},
    (4, 0): {"value": "100%", "desc": "Implemented and monitored GAD and school health PPAs",
             "mov": "GAD Plans and Budget, Documents related to OKD, WinS, SBFP, School Health, etc., Accomplishment Reports with M&E Results"},
    (4, 1): {"value": "100%", "desc": "Established partnership engagements",
             "mov": "Updated DPDS, MOA/MOU/DOD/DOA, Minutes of the Meeting, Accomplishment Reports with M&E Results, Distribution Lists"},
    (5, 0): {"mov": "Budget Utilization Report, Related Financial Records and Documents"},
    (6, 0): {"mov": "Operations Manual and/or Citizen's Charter, Document Tracking System, Administrative and Financial Reports"},
    (7, 0): {"mov": "Client Satisfaction Measure (CSM) Results, #8888 and CCB resolution and compliance documents"},
}


def _apply_kra_meta(kra, kra_index):
    meta = EOPCRF1_SEED_KRA_META.get(kra_index, {})
    kra.gaa_program = meta.get("gaa")
    kra.bedp_pillars = meta.get("bedp")
    kra.admin_agenda = meta.get("agenda")


def _apply_objective_meta(objective, kra_index, obj_index):
    meta = EOPCRF1_SEED_OBJECTIVE_META.get((kra_index, obj_index), {})
    objective.target_value = meta.get("value")
    objective.target_description = meta.get("desc")
    objective.mov_required = meta.get("mov")


# Years already synced in this process, so the (cheap but non-zero) sync
# below runs once per year per server start instead of on every request.
_EOPCRF1_SYNCED_YEARS = set()


def _sync_indicators(objective, indicators_seed):
    """Makes `objective`'s rubric indicators exactly match the seed. Only ever
    called for locked (Part I-A / I-C) objectives, whose indicators the UI
    can't edit. Ratings are stored on the objective itself, so changing an
    indicator's label never touches a rater's selected rating."""
    wanted = {
        (cat, rate): label
        for cat, levels in indicators_seed.items()
        for rate, label in levels.items()
    }
    existing = {(i.category, i.rate): i for i in objective.indicators}
    for key, indicator in existing.items():
        if key not in wanted:
            db.session.delete(indicator)
    for (cat, rate), label in wanted.items():
        indicator = existing.get((cat, rate))
        if indicator is None:
            db.session.add(EOPCRF1Indicator(
                objective_id=objective.id, category=cat, rate=rate, label=label,
            ))
        elif indicator.label != label:
            indicator.label = label


def seed_eopcrf1_defaults(year):
    """Creates -- or brings up to date -- the fixed Part I-A / Part I-C
    KRA + Objective + rubric-indicator skeleton for a year.

    Idempotent and non-destructive: existing locked KRAs/objectives are
    matched by position and only their text / weight / rubric indicators
    are corrected to the PDF. Ratings, MOV links, actual results and
    timeline entered by the rater are never touched. Runs once per year per
    process (see _EOPCRF1_SYNCED_YEARS).
    """
    if year in _EOPCRF1_SYNCED_YEARS:
        return

    locked_kras = (
        EOPCRF1Kra.query
        .filter(EOPCRF1Kra.year == year, EOPCRF1Kra.part != EOPCRF1_PART_B)
        .order_by(EOPCRF1Kra.sort_order.asc(), EOPCRF1Kra.id.asc())
        .all()
    )

    if len(locked_kras) == len(EOPCRF1_SEED_KRAS):
        # Existing seed (possibly from an older version of this file) --
        # correct it in place.
        for kra_index, (kra, kra_seed) in enumerate(zip(locked_kras, EOPCRF1_SEED_KRAS)):
            kra.text = kra_seed["text"]
            kra.weight = kra_seed["weight"]
            kra.part = kra_seed["part"]
            _apply_kra_meta(kra, kra_index)
            objectives = sorted(kra.objectives, key=lambda o: (o.sort_order, o.id))
            if len(objectives) != len(kra_seed["objectives"]):
                continue  # unexpected shape -- leave this KRA alone
            for obj_index, (objective, obj_seed) in enumerate(zip(objectives, kra_seed["objectives"])):
                objective.text = obj_seed["text"]
                objective.weight = obj_seed["weight"]
                _apply_objective_meta(objective, kra_index, obj_index)
                _sync_indicators(objective, obj_seed["indicators"])
        db.session.commit()
        _EOPCRF1_SYNCED_YEARS.add(year)
        return

    if locked_kras:
        # Partial/odd state -- don't guess; leave the data alone.
        _EOPCRF1_SYNCED_YEARS.add(year)
        return

    sort_order = db.session.query(db.func.max(EOPCRF1Kra.sort_order)).filter_by(year=year).scalar() or 0
    for kra_index, kra_seed in enumerate(EOPCRF1_SEED_KRAS):
        sort_order += 1
        kra = EOPCRF1Kra(
            year=year,
            part=kra_seed["part"],
            text=kra_seed["text"],
            weight=kra_seed["weight"],
            sort_order=sort_order,
        )
        _apply_kra_meta(kra, kra_index)
        db.session.add(kra)
        db.session.flush()  # assigns kra.id for the objectives below

        obj_order = 0
        for obj_index, obj_seed in enumerate(kra_seed["objectives"]):
            obj_order += 1
            objective = EOPCRF1Objective(
                kra_id=kra.id,
                text=obj_seed["text"],
                weight=obj_seed["weight"],
                sort_order=obj_order,
            )
            _apply_objective_meta(objective, kra_index, obj_index)
            db.session.add(objective)
            db.session.flush()
            _sync_indicators(objective, obj_seed["indicators"])

    db.session.commit()
    _EOPCRF1_SYNCED_YEARS.add(year)



# ---------------------------------------------------------------------------
# EOPCRF4 -- Part IV: Improvement and Development Plans
#
# One row per (year, part, position) -- there's no add/delete here, just six
# permanent plan rows (three per table) the ratee and rater fill in together.
#
#   Part IV-A (Office Improvement Plan) columns, all free text:
#     gap_analysis (Gap Analysis (SWOT)), improvement_area, objective
#     (General Objective), intervention (Recommended Improvement
#     Intervention), timeline, resources (Resources Needed)
#
#   Part IV-B (Individual Development Plan) columns:
#     strength_ref (Strengths) and dev_needs_ref (Improvement Needs) are
#     *pointers* to something already rated elsewhere, not freehand text:
#       "o:<id>"  -> an EOPCRF1Objective id
#       "c:<key>" -> an EOPCRF2 subsection key (EOPCRF2 has no
#                    per-subsection DB row of its own, so the key is all
#                    there is to reference)
#     objective (Learning Objective), intervention (Recommended
#     Developmental Intervention), timeline and resources are free text.
#
# Deliberately NOT resolved/validated here: which items currently rank in
# the "top 5" is a moving target, and turning a ref into a display label is
# left to eopcrf4.js, which already fetches /irc/eopcrf1/data and
# /irc/eopcrf2/data directly -- this table only remembers *which* ref the
# user picked.
# ---------------------------------------------------------------------------
class EOPCRF4Row(db.Model):
    __tablename__ = "eopcrf4_rows"
    __table_args__ = (
        db.UniqueConstraint("year", "part", "position", name="uq_eopcrf4_year_part_position"),
    )

    id = db.Column(db.Integer, primary_key=True)

    year = db.Column(db.Integer, nullable=False, index=True)
    part = db.Column(db.String(1), nullable=False)  # EOPCRF4_PARTS
    position = db.Column(db.Integer, nullable=False)  # EOPCRF4_POSITIONS

    # Part IV-A only
    gap_analysis = db.Column(db.Text, nullable=True)
    improvement_area = db.Column(db.Text, nullable=True)

    # Part IV-B only -- refs, see section comment above
    strength_ref = db.Column(db.String(64), nullable=True)
    dev_needs_ref = db.Column(db.String(64), nullable=True)

    # Shared by both parts (General Objective / Learning Objective, and
    # Recommended Improvement / Developmental Intervention)
    objective = db.Column(db.Text, nullable=True)
    intervention = db.Column(db.Text, nullable=True)
    timeline = db.Column(db.Text, nullable=True)
    resources = db.Column(db.Text, nullable=True)

    # One lock per row: the single edit-toggle button in the row's leading
    # column unlocks (and re-locks + saves) every cell in the row together.
    is_locked = db.Column(db.Boolean, nullable=False, default=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "year": self.year,
            "part": self.part,
            "position": self.position,
            "gapAnalysis": self.gap_analysis,
            "improvementArea": self.improvement_area,
            "strengthRef": self.strength_ref,
            "devNeedsRef": self.dev_needs_ref,
            "objective": self.objective,
            "intervention": self.intervention,
            "timeline": self.timeline,
            "resources": self.resources,
            "isLocked": self.is_locked,
        }


# One "Feedback:" box per table (Part IV-A / Part IV-B) per year.
class EOPCRF4Feedback(db.Model):
    __tablename__ = "eopcrf4_feedback"
    __table_args__ = (
        db.UniqueConstraint("year", "part", name="uq_eopcrf4_feedback_year_part"),
    )

    id = db.Column(db.Integer, primary_key=True)
    year = db.Column(db.Integer, nullable=False, index=True)
    part = db.Column(db.String(1), nullable=False)  # EOPCRF4_PARTS
    text = db.Column(db.Text, nullable=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


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
# "Checked by" signatory shown in the report-signatory footer (every page
# except EOPCRF3 and EOPCRF4, which use their own signatory blocks). Typed in
# by the user directly in the footer -- nothing is pre-filled. Single global
# row, same pattern as ReportPreparer: not year-scoped, never touched by any
# tab's Reset. The per-page date lives in ReportSignatoryDate (role
# "checked_by").
# ---------------------------------------------------------------------------
class ReportCheckedBy(db.Model):
    __tablename__ = "report_checked_by"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(255), nullable=False, default="")
    position = db.Column(db.String(255), nullable=False, default="")

    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ---------------------------------------------------------------------------
# EOPCRF1's own third signatory -- "Approving Authority" name shown alongside
# "Prepared by"/"Checked by" in the report-signatory footer, but only on the
# EOPCRF1 page itself (see base.html's active_tab.id == 'eopcrf1' check).
# Single global row, same pattern as ReportPreparer above.
#
# Position ("Assistant Schools Division Superintendent") is NOT stored here
# -- like "Checked by", it's a fixed value hardcoded directly in base.html.
# ---------------------------------------------------------------------------
class EOPCRF1ApprovingAuthority(db.Model):
    __tablename__ = "eopcrf1_approving_authority"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(255), nullable=False, default="")
    # Editable on EOPCRF I / EOPCRF IV. NOTE: new column -- existing databases
    # need it added (e.g. ALTER TABLE eopcrf1_approving_authority ADD COLUMN
    # position VARCHAR(255) NOT NULL DEFAULT '';) or a migration.
    position = db.Column(db.String(255), nullable=False, default="", server_default="")

    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ---------------------------------------------------------------------------
# EOPCRF1's printed-report header block -- the "Name of Rater / Position",
# "Name of Employee / Position", "Bureau/Center/Service/Division", and
# "Rating Period" / "Date of Review" fields that appear across the top of
# the official DEPED RPMS "Individual Performance Commitment and Review
# Form" (IPCRF) sheet. These are distinct from EOPCRF1ApprovingAuthority and
# the report-signatory footer -- those are the *signature line* at the
# bottom of the form; this is the identifying header info at the top.
#
# Single global row, lazily created on first access -- not year-scoped, and
# never touched by EOPCRF1's own Reset, since this is identity/period
# metadata, not KRA/objective report data.
# ---------------------------------------------------------------------------
class EOPCRF1ReportHeader(db.Model):
    __tablename__ = "eopcrf1_report_header"

    id = db.Column(db.Integer, primary_key=True)

    name_of_rater = db.Column(db.String(255), nullable=False, default="")
    position_of_rater = db.Column(db.String(255), nullable=False, default="")
    name_of_employee = db.Column(db.String(255), nullable=False, default="")
    position_of_employee = db.Column(db.String(255), nullable=False, default="")
    bureau = db.Column(db.String(255), nullable=False, default="")  # "Bureau/Center/Service/Division"
    rating_period = db.Column(db.String(255), nullable=False, default="")
    date_of_review = db.Column(db.Date, nullable=True)
    # Printed in the "Statement of Purpose" row of the OPCRF header block.
    # NOTE: new column -- added to existing DBs by _ensure_eopcrf1_schema().
    statement_of_purpose = db.Column(db.Text, nullable=False, default="", server_default="")

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
            "statementOfPurpose": self.statement_of_purpose or "",
        }


# ---------------------------------------------------------------------------
# Date shown under each signatory's position in the report-signatory footer
# (see base.html), one calendar-picked date per (tab, role) pair -- e.g.
# eopcrf1's "Prepared by" date is independent of eopcrf2's, even though both
# pages show the same preparer name (see ReportPreparer above).
#
# role is one of SIGNATORY_ROLES in app.py: "prepared_by", "checked_by", or
# "approving_authority" (the last one only ever appears on eopcrf1). Not
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