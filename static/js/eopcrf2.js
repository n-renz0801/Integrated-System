(function () {
  const sectionsLeadEl = document.getElementById("eopcrf2-sections-lead");
  const sectionsCbcEl = document.getElementById("eopcrf2-sections-cbc");
  if (!sectionsLeadEl || !sectionsCbcEl) return;

  // Maps a DATA section key to the container it renders into. Part II-A
  // (Leadership) and Part II-B (Core Behavioural) each get their own
  // guided-flow step.
  const SECTION_CONTAINERS = {
    leadership: sectionsLeadEl,
    cbc: sectionsCbcEl,
  };

  // Each part's total score is its average x 0.025 (see the form's
  // "Part II-A / II-B Total Score: Weighted Average (Average x 0.025)").
  const WEIGHT = 0.025;

  const summaryEls = {
    leadership: {
      avg: document.getElementById("eopcrf2-summary-lead"),
      desc: document.getElementById("eopcrf2-summary-lead-desc"),
      weighted: document.getElementById("eopcrf2-summary-lead-w"),
    },
    cbc: {
      avg: document.getElementById("eopcrf2-summary-cbc"),
      desc: document.getElementById("eopcrf2-summary-cbc-desc"),
      weighted: document.getElementById("eopcrf2-summary-cbc-w"),
    },
  };
  const summaryOverallEl = document.getElementById("eopcrf2-summary-overall");
  const summaryOverallDescEl = document.getElementById(
    "eopcrf2-summary-overall-desc",
  );
  const summaryOverallWeightedEl = document.getElementById(
    "eopcrf2-summary-overall-w",
  );

  const resetBtn = document.getElementById("eopcrf2-reset-btn");
  const resetConfirmOverlay = document.getElementById(
    "eopcrf2-reset-confirm-overlay",
  );
  const resetConfirmCancelBtn = document.getElementById(
    "eopcrf2-reset-confirm-cancel",
  );
  const resetConfirmConfirmBtn = document.getElementById(
    "eopcrf2-reset-confirm-confirm",
  );

  // ================= DepEd Competencies Scale =================
  const RATING_LABELS = {
    5: "Role Model",
    4: "Consistently Demonstrated",
    3: "Most of the Time Demonstrated",
    2: "Sometimes Demonstrated",
    1: "Rarely Demonstrated",
  };

  // ================= Fixed data model (from the Part II form) =================
  const DATA = [
    {
      key: "leadership",
      title: "Part II-A: Leadership Competencies (2.5%)",
      description:
        "Leadership Competencies shall capture competencies expected of heads of functional offices who hold managerial and executive/supervisory positions. The Leadership Competencies expected to be demonstrated include Leading People, People Performance Management, and People Development.",
      subsections: [
        {
          key: "leading_people",
          title: "Leading People",
          criteria: [
            "Uses basic persuasion techniques in a discussion or presentation e.g., staff mobilization, appeals to reason and/or emotions, uses data and examples, visual aids.",
            "Persuades, convinces or influences others, in order to have a specific impact or effect.",
            '"Sets a good example", is a credible and respected leader; and demonstrates desired behavior.',
            "Forwards personal, professional and work unit needs and interests in an issue.",
            "Assumes a pivotal role in promoting the development of an inspiring, relevant vision for the organization and influences others to share ownership of DepEd goals, in order to create an effective work environment.",
          ],
        },
        {
          key: "people_performance_management",
          title: "People Performance Management",
          criteria: [
            "Makes specific changes in the performance management system or in own work methods to improve performance (e.g. does something better, faster, at lower cost, more efficiently; improves quality, customer satisfaction, morale, revenues).",
            "Sets performance standards and measures progress of employees based on office and department targets.",
            "Provides feedback and technical assistance such as coaching for performance improvement and action planning.",
            "States performance expectations clearly and checks understanding and commitment.",
            "Performs all the stages of result-based performance management system supported by evidence and required documents/forms.",
          ],
        },
        {
          key: "people_development",
          title: "People Development",
          criteria: [
            "Improves the skills and effectiveness of individuals through employing a range of development strategies.",
            "Facilitates workforce effectiveness through coaching and motivating/developing people within a work environment that promotes mutual trust and respect.",
            "Conceptualizes and implements learning interventions to meet identified training needs.",
            "Does long-term coaching or training by arranging appropriate and helpful assignments, formal training, or other experiences for the purpose of supporting a person's learning and development.",
            "Cultivates a learning environment by structuring interactive experiences such as looking for future opportunities that are in support of achieving individual career goals.",
          ],
        },
      ],
    },
    {
      key: "cbc",
      title: "Part II-B: Core Behavioural Competencies (2.5%)",
      description:
        "Core Behavioral Competencies shall capture competencies required from all DepEd personnel in all job groups within the organization, upholding the DepEd’s core values and the Code of Conduct and Ethical Standards for Public Officials and Employees pursuant to RA 6713. They represent the way individuals embody and live the values of the organization.",
      subsections: [
        {
          key: "self_management",
          title: "Self-Management",
          criteria: [
            "Sets personal goals and direction, needs and development.",
            "Understands personal actions and behavior that are clear and purposive and takes into account personal goals and values congruent to that of the organization.",
            "Displays emotional maturity and enthusiasm for and is challenged by higher goals.",
            "Prioritize work tasks and schedules (through Gantt charts, checklists, etc.) to achieve goals.",
            "Sets high quality, challenging, realistic goals for self and others.",
          ],
        },
        {
          key: "professionalism_ethics",
          title: "Professionalism and Ethics",
          criteria: [
            "Demonstrate the values and behavior enshrined in the Norms of Conduct and Ethical Standards for Public Officials and Employees (RA 6713).",
            "Practice ethical and professional behavior and conduct taking into account the impact of his/her actions and decisions.",
            "Maintains a professional image: being trustworthy, regularity of attendance and punctuality, good grooming and communication.",
            "Makes personal sacrifices to meet the organization's needs.",
            "Act with a sense of urgency and responsibility to meet the organization's needs, improve system and help others improve their effectiveness.",
          ],
        },
        {
          key: "results_focus",
          title: "Results Focus",
          criteria: [
            "Achieves results with optimal use of time and resources most of the time.",
            "Avoids rework, mistakes and wastage through effective work methods by placing organizational needs before personal needs.",
            "Delivers error-free outputs most of the time by conforming to standard operating procedures correctly and consistently. Able to produce very satisfactory quality of work in terms of usefulness/acceptability and completeness with no supervision required.",
            "Expresses a desire to do better and may express frustration at waste or inefficiency. May focus on new or more precise ways of meeting goals set.",
            "Makes specific changes in the system or in own work methods to improve performance. Examples may include doing something better, faster, at a lower cost, more efficiently, or improving quality, customer satisfaction, morale, without setting any specific goal.",
          ],
        },
        {
          key: "teamwork",
          title: "Teamwork",
          criteria: [
            "Willingly does his/her share of responsibility.",
            "Promotes collaboration and removes barriers to teamwork and goal accomplishment across the organization.",
            "Applies negotiation principles in arriving at win-win agreements.",
            "Drives consensus and team ownership of decisions.",
            "Works constructively and collaboratively with others and across organizations to accomplish organizational goals and objectives.",
          ],
        },
        {
          key: "service_orientation",
          title: "Service Orientation",
          criteria: [
            "Can explain and articulate organizational directions, issues and problems.",
            "Takes personal responsibility for dealing with and/or correcting customer service issues and concerns.",
            "Initiates activities that promotes advocacy for men and women empowerment.",
            "Participates in updating office vision, mission, mandates and strategies based on DepEd strategies and directions.",
            "Develops and adopts service improvement program through simplified procedures that will further enhance service delivery.",
          ],
        },
        {
          key: "innovation",
          title: "Innovation",
          criteria: [
            "Examines the root cause of problems and suggests effective solutions. Foster new ideas, processes, and suggests better ways to do things (cost and/or operational efficiency).",
            'Demonstrates an ability to think "beyond the box". Continuously focuses on improving personal productivity to create higher value and results.',
            "Promotes a creative climate and inspires co-workers to develop original ideas or solutions.",
            "Translates creative thinking into tangible changes and solutions that improve the work unit and organization.",
            "Uses ingenious methods to accomplish responsibilities. Demonstrates resourcefulness and the ability to succeed with minimal resources.",
          ],
        },
      ],
    },
  ];

  // ================= State =================
  // ratings[subsectionKey] = [r1..r5]   (each null or 1-5)
  // remarks[subsectionKey] = [t1..t5]   (Remarks / Observations text)
  const ratings = {};
  const remarks = {};
  const SUBSECTION_TO_SECTION = {};
  DATA.forEach((section) => {
    section.subsections.forEach((sub) => {
      ratings[sub.key] = sub.criteria.map(() => null);
      remarks[sub.key] = sub.criteria.map(() => "");
      SUBSECTION_TO_SECTION[sub.key] = section.key;
    });
  });

  const YEAR = new Date().getFullYear();

  // ================= Server sync =================
  // Only the numbers and remarks the user enters are persisted; the
  // sections/subsections/indicators above stay hardcoded.
  async function loadRatings() {
    try {
      const res = await fetch(`/irc/eopcrf2/data?year=${YEAR}`);
      if (!res.ok) throw new Error("Failed to load ratings");
      const data = await res.json();
      const serverRatings = data.ratings || {};
      const serverRemarks = data.remarks || {};

      Object.keys(serverRatings).forEach((subKey) => {
        if (!ratings[subKey]) return; // unknown subsection key -- ignore
        Object.entries(serverRatings[subKey]).forEach(([idxStr, value]) => {
          const idx = Number(idxStr);
          if (idx >= 0 && idx < ratings[subKey].length) {
            ratings[subKey][idx] = value;
          }
        });
      });

      Object.keys(serverRemarks).forEach((subKey) => {
        if (!remarks[subKey]) return;
        Object.entries(serverRemarks[subKey]).forEach(([idxStr, text]) => {
          const idx = Number(idxStr);
          if (idx >= 0 && idx < remarks[subKey].length) {
            remarks[subKey][idx] = text || "";
          }
        });
      });
    } catch (err) {
      console.error("Failed to load EOPCRF2 data:", err);
    }
    render();
  }

  // `fields` is any of { rating, remarks } -- the server only touches the
  // fields that are present in the body.
  async function saveEntry(subKey, idx, fields) {
    try {
      const res = await fetch("/irc/eopcrf2/rating", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year: YEAR,
          sectionKey: SUBSECTION_TO_SECTION[subKey],
          subsectionKey: subKey,
          criterionIndex: idx,
          ...fields,
        }),
      });
      if (!res.ok) throw new Error("Save failed");
    } catch (err) {
      console.error("Failed to save EOPCRF2 entry:", err);
    }
  }

  // ================= Reset-page confirmation modal =================
  // No bulk-clear endpoint: reset fires one best-effort clear request per
  // indicator that currently has a rating or remark.
  function openResetConfirm() {
    resetConfirmOverlay.classList.add("visible");
  }

  function closeResetConfirm() {
    resetConfirmOverlay.classList.remove("visible");
  }

  resetBtn.addEventListener("click", openResetConfirm);
  resetConfirmCancelBtn.addEventListener("click", closeResetConfirm);
  resetConfirmOverlay.addEventListener("click", (e) => {
    if (e.target === resetConfirmOverlay) closeResetConfirm();
  });

  resetConfirmConfirmBtn.addEventListener("click", async () => {
    resetConfirmConfirmBtn.disabled = true;
    try {
      const clears = [];
      Object.keys(ratings).forEach((subKey) => {
        ratings[subKey].forEach((value, idx) => {
          if (value !== null || remarks[subKey][idx] !== "") {
            clears.push(saveEntry(subKey, idx, { rating: null, remarks: "" }));
          }
          ratings[subKey][idx] = null;
          remarks[subKey][idx] = "";
        });
      });
      await Promise.all(clears);
    } finally {
      render();
      resetConfirmConfirmBtn.disabled = false;
      closeResetConfirm();
    }
  });

  // ================= Helpers =================
  function fmtNum(n) {
    if (n === null || n === undefined || isNaN(n)) return "—";
    return (Math.round(n * 100) / 100).toFixed(2);
  }

  // Weighted scores are small (avg x 0.025), so keep 4 decimals.
  function fmtWeighted(n) {
    if (n === null || n === undefined || isNaN(n)) return "—";
    return n.toFixed(4);
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : str;
    return div.innerHTML;
  }

  function escapeAttr(str) {
    return escapeHtml(str).replace(/"/g, "&quot;");
  }

  function average(values) {
    const rated = values.filter((v) => v !== null && v !== undefined);
    if (rated.length === 0) return null;
    return rated.reduce((sum, v) => sum + v, 0) / rated.length;
  }

  // Closest 1-5 adjectival rating for a numeric average, e.g. 4.3 ->
  // "Consistently Demonstrated". Empty when nothing is rated.
  function ratingDescription(avg) {
    if (avg === null || avg === undefined || isNaN(avg)) return "";
    const rounded = Math.min(5, Math.max(1, Math.round(avg)));
    return RATING_LABELS[rounded];
  }

  function subsectionAverage(subKey) {
    return average(ratings[subKey]);
  }

  function sectionAverage(section) {
    const subAvgs = section.subsections
      .map((sub) => subsectionAverage(sub.key))
      .filter((v) => v !== null);
    return average(subAvgs);
  }

  function weightedScore(avg) {
    return avg === null ? null : avg * WEIGHT;
  }

  // ================= Render =================
  function render() {
    sectionsLeadEl.innerHTML = "";
    sectionsCbcEl.innerHTML = "";

    DATA.forEach((section) => {
      const container = SECTION_CONTAINERS[section.key];
      if (!container) return;

      const sectionCard = document.createElement("div");
      sectionCard.className = "eopcrf2-section";

      const secAvg = sectionAverage(section);
      const subHtml = section.subsections.map(renderSubsection).join("");

      sectionCard.innerHTML = `
        <div class="eopcrf2-section-header">
          <span class="eopcrf2-section-title">${escapeHtml(section.title)}</span>
          <span class="eopcrf2-section-avg">${fmtNum(secAvg)}</span>
        </div>
        <p class="eopcrf2-section-desc">${escapeHtml(section.description)}</p>
        <div class="eopcrf2-subsection-list">${subHtml}</div>
        <div class="eopcrf2-section-footer">
          <span>${escapeHtml(section.title.split(":")[0])} Total Score: Weighted Average (Average x ${WEIGHT})</span>
          <span class="eopcrf2-section-footer-value">${fmtWeighted(weightedScore(secAvg))}</span>
        </div>
      `;

      container.appendChild(sectionCard);
    });

    updateSummary();
  }

  function renderSubsection(sub) {
    const subAvg = subsectionAverage(sub.key);
    const rowsHtml = sub.criteria
      .map((text, i) => renderCriterionRow(sub.key, i, text))
      .join("");

    return `
      <div class="eopcrf2-subsection-card">
        <div class="eopcrf2-subsection-header">
          <span class="eopcrf2-subsection-title">${escapeHtml(sub.title)}</span>
          <span class="eopcrf2-subsection-avg">${fmtNum(subAvg)}</span>
        </div>
        <div class="eopcrf2-criteria-list">${rowsHtml}</div>
      </div>
    `;
  }

  function renderCriterionRow(subKey, index, text) {
    const current = ratings[subKey][index];
    const buttons = [5, 4, 3, 2, 1]
      .map((r) => {
        const selected = current === r ? " eopcrf2-rate-btn--selected" : "";
        return `<button type="button" class="eopcrf2-rate-btn${selected}" data-sub="${subKey}" data-idx="${index}" data-rate="${r}" title="${r} — ${RATING_LABELS[r]}">${r}</button>`;
      })
      .join("");

    return `
      <div class="eopcrf2-criterion-row">
        <span class="eopcrf2-criterion-num">${index + 1}</span>
        <div class="eopcrf2-criterion-body">
          <span class="eopcrf2-criterion-text">${escapeHtml(text)}</span>
          <input type="text" class="eopcrf2-remarks" data-sub="${subKey}" data-idx="${index}" maxlength="500" placeholder="Remarks / Observations" value="${escapeAttr(remarks[subKey][index])}" />
        </div>
        <div class="eopcrf2-rate-group">${buttons}</div>
      </div>
    `;
  }

  function updateSummary() {
    const leadSection = DATA.find((s) => s.key === "leadership");
    const cbcSection = DATA.find((s) => s.key === "cbc");

    const parts = [
      ["leadership", sectionAverage(leadSection)],
      ["cbc", sectionAverage(cbcSection)],
    ];

    let totalWeighted = null;
    parts.forEach(([key, avg]) => {
      const els = summaryEls[key];
      const w = weightedScore(avg);
      els.avg.textContent = fmtNum(avg);
      els.desc.textContent = ratingDescription(avg);
      els.weighted.textContent =
        w === null ? "" : `Weighted: ${fmtWeighted(w)}`;
      if (w !== null) totalWeighted = (totalWeighted || 0) + w;
    });

    // Total = sum of the parts that have been rated (Part II-A only
    // applies to heads of offices, so II-B alone is a valid total).
    summaryOverallEl.textContent = fmtWeighted(totalWeighted);
    const overallAvg = average(
      parts.map((p) => p[1]).filter((v) => v !== null),
    );
    summaryOverallDescEl.textContent = ratingDescription(overallAvg);
    summaryOverallWeightedEl.textContent =
      overallAvg === null ? "" : `Overall average: ${fmtNum(overallAvg)}`;
  }

  // ================= Events =================
  function handleRateClick(e) {
    const btn = e.target.closest(".eopcrf2-rate-btn");
    if (!btn) return;

    const subKey = btn.dataset.sub;
    const idx = parseInt(btn.dataset.idx, 10);
    const rate = parseInt(btn.dataset.rate, 10);

    // Clicking the already-selected rating clears it; otherwise sets it.
    const newValue = ratings[subKey][idx] === rate ? null : rate;
    ratings[subKey][idx] = newValue;

    render();
    saveEntry(subKey, idx, { rating: newValue });
  }

  // Remarks: keep state current on every keystroke (so a re-render from a
  // rating click never loses text), but only hit the server on change/blur.
  function handleRemarksInput(e) {
    const input = e.target.closest(".eopcrf2-remarks");
    if (!input) return;
    remarks[input.dataset.sub][parseInt(input.dataset.idx, 10)] = input.value;
  }

  function handleRemarksChange(e) {
    const input = e.target.closest(".eopcrf2-remarks");
    if (!input) return;
    const subKey = input.dataset.sub;
    const idx = parseInt(input.dataset.idx, 10);
    saveEntry(subKey, idx, { remarks: input.value.trim() });
  }

  [sectionsLeadEl, sectionsCbcEl].forEach((el) => {
    el.addEventListener("click", handleRateClick);
    el.addEventListener("input", handleRemarksInput);
    el.addEventListener("change", handleRemarksChange);
  });

  // ================= Initial load =================
  loadRatings();
})();
