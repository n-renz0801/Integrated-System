"""
EOPCRF_SH -- Database Models
=============================
SQLAlchemy models for this app's four tabs -- EOPCRF1 (IPCRF), EOPCRF2 (Part II:
Leadership and Core Behavioural Competencies), IRC8c (Summary of Ratings for
Discussion / Development Plans), and EOPCRF3 (read-only Part III: Summary of Ratings) --
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

# The Development Plans table on IRC8c has exactly four fixed rows -- two
# fed by EOPCRF1 (Key Result Areas/Objectives) and two fed by EOPCRF2 (Part II
# Behavioral Competencies/Core Skills subsections) -- rather than a
# user-managed add/delete list. "_1"/"_2" gives each source two
# independent picks (e.g. two different strong objectives) rather than
# forcing everything into one row per source.
IRC8C_SLOT_EOPCRF1_1 = "eopcrf1_1"
IRC8C_SLOT_EOPCRF1_2 = "eopcrf1_2"
IRC8C_SLOT_IRC8B_1 = "irc8b_1"
IRC8C_SLOT_IRC8B_2 = "irc8b_2"
IRC8C_SLOTS = (IRC8C_SLOT_EOPCRF1_1, IRC8C_SLOT_EOPCRF1_2, IRC8C_SLOT_IRC8B_1, IRC8C_SLOT_IRC8B_2)


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
# exactly as printed in the PDF, including its own typos and the lines
# that the PDF itself cuts off mid-sentence (the source is an Excel
# "Print to PDF", which clips text that doesn't fit its cell).
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
                    5: "Submission was done within the",
                    4: "Submission was done 1-2 days after the",
                    3: "Submission was done 3-4 days after the",
                    2: "Submission was done 5-6 days after the",
                    1: "Submission was done more than 6 days after",
                },
            },
        },
        {
            "text": "1.7. Utilize available monitoring and evaluation processes and tools to promote learner achievement",
            "weight": 3,
            "indicators": {
                "quality": {
                    5: "Evaluated and analyzed the monitoring",
                    4: "Consolidated the M&E results of implemented",
                    3: "Utilized M&E processes and tools to promote",
                    2: "Developed tools for the M&E of school PPAs",
                    1: "Assigned committees for the M&E of school",
                },
                "efficiency": {
                    5: "96-100% PPAs were implemented with",
                    4: "91-95% PPAs were implemented with M&E",
                    3: "86-90% PPAs were implemented with M&E",
                    2: "81-86% PPAs were implemented with M&E",
                    1: "80% and below PPAs were implemented with",
                },
                "timeliness": {
                    5: "Submission was done within the",
                    4: "Submission was done 1-2 days after the",
                    3: "Submission was done 3-4 days after the",
                    2: "Submission was done 5-6 days after the",
                    1: "Submission was done more than 6 days after",
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
                    5: "Evaluated and analyzed the school data",
                    4: "Monitored the management school data and",
                    3: "Managed school data and information (LIS,",
                    2: "Consolidated school data and information",
                    1: "Gathered school data and information using",
                },
                "efficiency": {
                    5: "96-100% of EMIS and records action were",
                    4: "91-95% of EMIS and records action were",
                    3: "86-90% of EMIS and records action were",
                    2: "81-85% of EMIS and records action were",
                    1: "80% and below of EMIS and records action",
                },
                "timeliness": {
                    5: "EMIS and records action were complied",
                    4: "EMIS and records action were complied 1-2",
                    3: "EMIS and records action were complied 3-4 days",
                    2: "EMIS and records actions were complied 5-6",
                    1: "EMIS and records actions were complied",
                },
            },
        },
        {
            "text": "2.3. Manage school facilities and equipment in adherence to policies, guidelines and issuances on acquisition, recording,",
            "weight": 3,
            "indicators": {
                "quality": {
                    5: "Evaluated and analyzed the status of",
                    4: "Monitored the school facilities, equipment and",
                    3: "Managed school facilities, equipment and",
                    2: "Maintained an inventory of school facilities,",
                    1: "Kept proofs of acceptance of school facilities,",
                },
                "efficiency": {
                    5: "96-100% of school properties are",
                    4: "91-95% of school properties are accounted in",
                    3: "86-90% of school properties are accounted in",
                    2: "81-85% of school properties are accounted",
                    1: "80% and below of school properties are",
                },
                "timeliness": {
                    5: "Inventory reports were submitted within",
                    4: "Inventory reports were submitted 1-2 days after",
                    3: "Inventory reports were submitted 3-4 days after",
                    2: "Inventory reports were submitted 5-6 days",
                    1: "Inventory reports were submitted more than 6",
                },
            },
        },
        {
            "text": "2.5. Manage school safety for disaster preparedness, mitigation and resiliency to ensure continuous delivery of instruction",
            "weight": 3,
            "indicators": {
                "quality": {
                    5: "Evaluated and analyzed the status of",
                    4: "Monitored the implementation of school safety",
                    3: "Managed school safety for disaster",
                    2: "Gathered relevant data for the crafting of",
                    1: "Constituted the members of the school",
                },
                "efficiency": {
                    5: "96-100% of DRRM PPAs were",
                    4: "91-95% of DRRM PPAs were implemented",
                    3: "86-90% of DRRM PPAs were implemented and",
                    2: "81-85% of DRRM PPAs were implemented",
                    1: "80% and below of DRRM PPAs were",
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
                    5: "Evaluated and analyzed the status of",
                    4: "Monitored the emerging opportunities and",
                    3: "Managed emerging opportunities and challenges",
                    2: "Gathered relevant data for the crafting of",
                    1: "Designated school coordinators for learner",
                },
                "efficiency": {
                    5: "96-100% of learner support PPAs were",
                    4: "91-95% of learner support PPAs were",
                    3: "86-90% of learner support PPAs were",
                    2: "81-85% of learner support PPAs were",
                    1: "80% and below of learner support PPAs were",
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
            "text": "3.2. Provide technical assistance to teachers on teaching standards and pedagogies within and across learning areas to improve",
            "weight": 7,
            "indicators": {
                "quality": {
                    5: "Evaluated and analyzed the status of the",
                    4: "Monitored the status of the provided TA and IS",
                    3: "Provided TA and IS to teachers on teaching",
                    2: "Crafted the SSIS and the IS and TA plans",
                    1: "Designated TA providers to teachers",
                },
                "efficiency": {
                    5: "96-100% of teachers were provided with",
                    4: "91-95% of teachers were provided with",
                    3: "86-90% of teachers were provided with technical",
                    2: "81-85% of teachers were provided with",
                    1: "80% and below of teachers were provided",
                },
                "timeliness": {
                    5: "Reports were submitted within the",
                    4: "Reports were submitted 1-2 days after the",
                    3: "Reports were submitted 3-4 days after the",
                    2: "Reports were submitted 5-6 days after the",
                    1: "Reports were submitted more than 6 days",
                },
            },
        },
        {
            "text": "3.4. Utilize learning outcomes in developing data-based interventions to maintain learner achievement and attain other performance",
            "weight": 7,
            "indicators": {
                "quality": {
                    5: "Evaluated and analyzed the learning",
                    4: "Monitored the implementation of data-based",
                    3: "Utilized LOA results in developing data-based",
                    2: "Consolidated LOA results in all grade levels",
                    1: "Gather LOA results in all grade levels and",
                },
                "efficiency": {
                    5: "Attained LOA results higher than the",
                    4: "Attained LOA results higher than the school's",
                    3: "Attained LOA results that meet the school's",
                    2: "Attained LOA results below the school's",
                    1: "Attained LOA results below the school's",
                },
                "timeliness": {
                    5: "Submitted the LOA report within the",
                    4: "Submitted the LOA report 1-2 days after the",
                    3: "Submitted the LOA report 3-4 days after the",
                    2: "Submitted the LOA report 5-6 days after the",
                    1: "Submitted the LOA report more than 5 days",
                },
            },
        },
        {
            "text": "3.6. Manage a learning-friendy, inclusive and healthy learning environment through effective learning resource management",
            "weight": 3,
            "indicators": {
                "quality": {
                    5: "Evaluated and analyzed the status of",
                    4: "Monitored the learner-friendly, inclusive and",
                    3: "Managed a learning-friendy, inclusive and",
                    2: "Established a school learning resource",
                    1: "Maintained an inventory of learning resources",
                },
                "efficiency": {
                    5: "96-100% of available learning resources",
                    4: "91-95% of available learning resources were",
                    3: "86-90% of available learning resources were",
                    2: "81-85% of available learning resources were",
                    1: "96-100% of available learning resources",
                },
                "timeliness": {
                    5: "Reports were submitted within the",
                    4: "Reports were submitted 1-2 days after the",
                    3: "Reports were submitted 3-4 days after the",
                    2: "Reports were submitted 5-6 days after the",
                    1: "Reports were submitted more than 6 days",
                },
            },
        },
        {
            "text": "3.7. Ensure integration of career awareness and opportunities in the provision of learning experiences aligned with the curriculum",
            "weight": 3,
            "indicators": {
                "quality": {
                    5: "Evaluated and analyzed the integration of",
                    4: "Monitored the integration of career awareness",
                    3: "Ensured the integration of career awareness and",
                    2: "Crafted plans for the conduct of co-curricular",
                    1: "Assigned committees for the conduct of co-",
                },
                "efficiency": {
                    5: "96-100% of curriculum support PPAs were",
                    4: "91-95% of curriculum support PPAs were",
                    3: "86-90% of curriculum support PPAs were",
                    2: "81-85% of curriculum support PPAs were",
                    1: "80% and below of curriculum support PPAs",
                },
                "timeliness": {
                    5: "Reports were submitted within the",
                    4: "Reports were submitted 1-2 days after the",
                    3: "Reports were submitted 3-4 days after the",
                    2: "Reports were submitted 5-6 days after the",
                    1: "Reports were submitted more than 6 days",
                },
            },
        },
    ]},
    {"part": EOPCRF1_PART_A, "text": "Developing Self and Others (School Operations and Management)", "weight": 10, "objectives": [
        {
            "text": "4.4. Implement the performance management system with a team to support the career advancement of school",
            "weight": 4,
            "indicators": {
                "quality": {
                    5: "Evaluated and analyzed the",
                    4: "Monitored the implementation of RPMS with a",
                    3: "Implemented the RPMS with a team to support",
                    2: "Oriented the school personnel on the",
                    1: "Constituted the school performance",
                },
                "efficiency": {
                    5: "96-100% of employees have undergone",
                    4: "91-95% of employees have undergone the",
                    3: "86-90% of employees have undergone the",
                    2: "81-85% of employees have undergone the",
                    1: "80% and below of employees have",
                },
                "timeliness": {
                    5: "Signed PCRFs submitted within the",
                    4: "Signed PCRFs submitted 1-2 days after the",
                    3: "Signed PCRFs submitted 3-4 days after the",
                    2: "Signed PCRFs submitted 5-6 days after the",
                    1: "Signed PCRFs submitted more than 6 days",
                },
            },
        },
        {
            "text": "4.5. Implement professional development initiatives to enhance strengths and address performance gaps among school personnel",
            "weight": 4,
            "indicators": {
                "quality": {
                    5: "Evaluated and analyzed the",
                    4: "Monitored the implementation of professional",
                    3: "Implemented professional development initiatives",
                    2: "Crafted plans and proposals for the conduct",
                    1: "Designated school coordinator and teams for",
                },
                "efficiency": {
                    5: "96-100% of school personnel participated",
                    4: "91-95% of school personnel participated in",
                    3: "86-90% of school personnel participated in",
                    2: "81-85% of school personnel participated in",
                    1: "80% and below of school personnel",
                },
                "timeliness": {
                    5: "Approved training proposals and",
                    4: "Approved training proposals and",
                    3: "Approved training proposals and accomplishment",
                    2: "Approved training proposals and",
                    1: "Approved training proposals and",
                },
            },
        },
        {
            "text": "4.7. Implement laws, policies, guidelines and issuances on the rights, privileges and benefits of school personnel to ensure their",
            "weight": 1,
            "indicators": {
                "quality": {
                    5: "Evaluated and analyzed the",
                    4: "Monitored the implementation of laws, policies,",
                    3: "Implemented laws, policies, guidelines and",
                    2: "Personnel actions complied with revisions",
                    1: "Personnel actions have backlog and",
                },
                "efficiency": {
                    5: "96-100% of personnel action were",
                    4: "91-95% of personnel action were complied and",
                    3: "86-90% of personnel action were complied and",
                    2: "81-85% of personnel action were complied",
                    1: "80% and below of personnel action were",
                },
                "timeliness": {
                    5: "Personnel action were complied within the",
                    4: "Personnel action were complied 1-2 days after",
                    3: "Personnel action were complied 3-4 days after",
                    2: "Personnel action were complied 5-6 days",
                    1: "Personnel action were complied more than 6",
                },
            },
        },
        {
            "text": "4.8. Implement a school rewards system to recognize and motivate learners, school personnel and other stakeholders for",
            "weight": 1,
            "indicators": {
                "quality": {
                    5: "Evaluated and analyzed the school",
                    4: "Monitored the school rewards system to",
                    3: "Implemented a school rewards system to",
                    2: "Initiated the establishment of a rewards and",
                    1: "No rewards and recognition system",
                },
                "efficiency": {
                    5: "96-100% of target awardees were",
                    4: "91-95% of target awardees were recognized",
                    3: "86-90% of target awardees were recognized",
                    2: "81-85% of target awardees were recognized",
                    1: "80% and below of target awardees were",
                },
                "timeliness": {
                    5: "Reports were submitted within the",
                    4: "Reports were submitted 1-2 days after the",
                    3: "Reports were submitted 3-4 days after the",
                    2: "Reports were submitted 5-6 days after the",
                    1: "Reports were submitted more than 6 days",
                },
            },
        },
    ]},
    {"part": EOPCRF1_PART_A, "text": "Building Connections (Learner Formation and Development)", "weight": 7, "objectives": [
        {
            "text": "5.3. Exhibit inclusive practices such as gender sensitivity, physical and mental health awareness and culture",
            "weight": 3,
            "indicators": {
                "quality": {
                    5: "Evaluated and analyzed inclusive",
                    4: "Monitored inclusive practices such as gender",
                    3: "Exhibited inclusive practices such as gender",
                    2: "Crafted plans and proposals for the conduct",
                    1: "Designated school coordinators for GAD and",
                },
                "efficiency": {
                    5: "96-100% of GAD and school health PPAs",
                    4: "91-95% of GAD and school health PPAs were",
                    3: "86-90% of GAD and school health PPAs were",
                    2: "81-85% of GAD and school health PPAs",
                    1: "80% and below of learner support PPAs were",
                },
                "timeliness": {
                    5: "Reports were submitted within the",
                    4: "Reports were submitted 1-2 days after the",
                    3: "Reports were submitted 3-4 days after the",
                    2: "Reports were submitted 5-6 days after the",
                    1: "Reports were submitted more than 6 days",
                },
            },
        },
        {
            "text": "5.5. Initiate partnerships with the community, such as parents, alumni, authorities, industries and other stakeholders, to",
            "weight": 4,
            "indicators": {
                "quality": {
                    5: "Evaluated and analyzed the partnerships",
                    4: "Monitored the status of partnerships with the",
                    3: "Initiated partnerships with the community, such",
                    2: "Identified potential education partners to",
                    1: "No education partner identified",
                },
                "efficiency": {
                    5: "Established 7 or more partnership",
                    4: "Established 5-6 partnership engagements with",
                    3: "Established 3-4 partnership engagements with",
                    2: "Established 2 partnership engagements with",
                    1: "Established 1 partnership engagement with",
                },
                "timeliness": {
                    5: "Reports and DPDS updated within the",
                    4: "Reports and DPDS updated 1-2 days after the",
                    3: "Reports and DPDS updated 3-4 days after the",
                    2: "Reports and DPDS updated 5-6 days after",
                    1: "Reports and DPDS updated more than 6",
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
                    5: "Budget allocation disbursed within the",
                    4: "Budget allocation disbursed within the",
                    3: "Budget allocation disbursed within the",
                    2: "Budget allocation disbursed within the",
                    1: "Budget allocation disbursed within the",
                },
                "efficiency": {
                    5: "Budget is utilized according to the BUR",
                    4: "Budget is utilized with 1-5% variance from",
                    3: "Budget is utilized with 6-10% variance from BUR",
                    2: "Budget is utilized with 11-15% variance from",
                    1: "Budget is utilized with more than 15%",
                },
                "timeliness": {
                    5: "Quarterly basis:",
                    4: "Quarterly basis:",
                    3: "Quarterly basis:",
                    2: "Quarterly basis:",
                    1: "Quarterly basis:",
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
                    5: "Improvements/reduction on all of the",
                    4: "Improvements/reduction on 4 service standards",
                    3: "Improvements/reduction on 2-3 service",
                    2: "Improvements/reduction on 1 service",
                    1: "No change in no. of documentary",
                },
                "efficiency": {
                    5: "Streamlined and/or digitized all office core",
                    4: "Streamlined and/or digitized 76-99% of the",
                    3: "Streamlined and/or digitized 51-75% of the office",
                    2: "Streamlined and/or digitized 26-50% of the",
                    1: "Streamlined and/or digitized 0-25% of the",
                },
                "timeliness": {
                },
            },
        },
    ]},
    {"part": EOPCRF1_PART_C, "text": "Client Satisfaction", "weight": 5, "objectives": [
        {
            "text": "Achieved 100% resolution and compliance rate to #8888 and CCB complaints within the prescribed processing time (simple - 3 days; complex - 7 days; highly technical - 20 days) with at least Satisfactory overall average result on the Client",
            "weight": 5,
            "indicators": {
                "quality": {
                    5: "95.0% - 100% (Outstanding) overall",
                    4: "90.9% - 94.9% (Very Satisfactory) overall",
                    3: "80.0% - 89.9% (Satisfactory) overall average on",
                    2: "60.0% - 79.9% (Fair) overall average on the",
                    1: "Below 60.0% (Poor) overall average on the",
                },
                "efficiency": {
                    5: "100% resolution and compliance rate to",
                    4: "At least 80% resolution and compliance rate to",
                    3: "At least 50% resolution and compliance rate to",
                    2: "At least 1% resolution and compliance rate",
                    1: "0% resolution and compliance rate to #8888",
                },
                "timeliness": {
                    5: "Complaints acted upon and closed within",
                    3: "Complaints are acted upon and closed with",
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
        for kra, kra_seed in zip(locked_kras, EOPCRF1_SEED_KRAS):
            kra.text = kra_seed["text"]
            kra.weight = kra_seed["weight"]
            kra.part = kra_seed["part"]
            objectives = sorted(kra.objectives, key=lambda o: (o.sort_order, o.id))
            if len(objectives) != len(kra_seed["objectives"]):
                continue  # unexpected shape -- leave this KRA alone
            for objective, obj_seed in zip(objectives, kra_seed["objectives"]):
                objective.text = obj_seed["text"]
                objective.weight = obj_seed["weight"]
                _sync_indicators(objective, obj_seed["indicators"])
        db.session.commit()
        _EOPCRF1_SYNCED_YEARS.add(year)
        return

    if locked_kras:
        # Partial/odd state -- don't guess; leave the data alone.
        _EOPCRF1_SYNCED_YEARS.add(year)
        return

    sort_order = db.session.query(db.func.max(EOPCRF1Kra.sort_order)).filter_by(year=year).scalar() or 0
    for kra_seed in EOPCRF1_SEED_KRAS:
        sort_order += 1
        kra = EOPCRF1Kra(
            year=year,
            part=kra_seed["part"],
            text=kra_seed["text"],
            weight=kra_seed["weight"],
            sort_order=sort_order,
        )
        db.session.add(kra)
        db.session.flush()  # assigns kra.id for the objectives below

        obj_order = 0
        for obj_seed in kra_seed["objectives"]:
            obj_order += 1
            objective = EOPCRF1Objective(
                kra_id=kra.id,
                text=obj_seed["text"],
                weight=obj_seed["weight"],
                sort_order=obj_order,
            )
            db.session.add(objective)
            db.session.flush()
            _sync_indicators(objective, obj_seed["indicators"])

    db.session.commit()
    _EOPCRF1_SYNCED_YEARS.add(year)



# ---------------------------------------------------------------------------
# IRC8c -- Summary of Ratings for Discussion
#
# One row per fixed slot (see IRC8C_SLOTS above) -- there's no add/delete
# here, just four permanent Development Plan entries the ratee and rater
# fill in together. "Strength" and "Development Need" aren't freehand text:
# they're a *pointer* to something already rated elsewhere --
#   - eopcrf1_1 / eopcrf1_2  -> strength_ref/dev_needs_ref hold the id of an
#     EOPCRF1Objective (as a string, so this column can hold either kind of
#     ref without a polymorphic FK)
#   - irc8b_1 / irc8b_2  -> they hold an EOPCRF2 subsection key (e.g.
#     "self_management") -- EOPCRF2 has no per-subsection DB row of its own
#     (subsection titles are hardcoded in eopcrf2.js), so the key is all
#     there is to reference.
#
# Deliberately NOT resolved/validated here: which objectives or subsections
# currently rank in the "top 5" is a moving target, and resolving a ref
# into a display label is left to irc8c.js, which already fetches
# /irc/eopcrf1/data and /irc/eopcrf2/data directly -- this table only
# remembers *which* ref the user picked.
#
# The Final Performance Results Rating shown on IRC8c is likewise not
# stored -- it's the live sum of every EOPCRF1Objective.score() for the
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

    # Ref into EOPCRF1Objective.id (eopcrf1_* slots) or an EOPCRF2 subsection key
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
            "source": "eopcrf1" if self.slot.startswith("eopcrf1") else "irc8b",
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