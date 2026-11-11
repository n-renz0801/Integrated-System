(function () {
  const workspaceEl = document.getElementById("eopcrf2-workspace");
  if (!workspaceEl) return;
  const listEl = document.getElementById("eopcrf2-list");
  const editorEl = document.getElementById("eopcrf2-editor");
  const progressCountEl = document.getElementById("eopcrf2-progress-count");
  const segsEl = document.getElementById("eopcrf2-segments");
  const nextBtn = document.getElementById("eopcrf2-next-incomplete");
  const doneBadge = document.getElementById("eopcrf2-done-badge");

  // Each part's total score is its average x 0.025 (see the form's
  // "Part II-A / II-B Total Score: Weighted Average (Average x 0.025)").
  const WEIGHT = 0.025;

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
  const ratings = {};
  const SUBSECTION_TO_SECTION = {};
  DATA.forEach((section) => {
    section.subsections.forEach((sub) => {
      ratings[sub.key] = sub.criteria.map(() => null);
      SUBSECTION_TO_SECTION[sub.key] = section.key;
    });
  });

  const YEAR = new Date().getFullYear();

  // View state: which competency is open.
  const sel = { subKey: null };
  let confirmClear = false; // "Clear competency" is waiting for Clear / Keep
  const PART_SHORT = {
    leadership: { label: "Part II-A", name: "Leadership Competencies" },
    cbc: { label: "Part II-B", name: "Core Behavioural Competencies" },
  };

  // ================= Server sync =================
  // Only the numbers the user enters are persisted; the
  // sections/subsections/indicators above stay hardcoded.
  async function loadRatings() {
    try {
      const res = await fetch(`/irc/eopcrf2/data?year=${YEAR}`);
      if (!res.ok) throw new Error("Failed to load ratings");
      const data = await res.json();
      const serverRatings = data.ratings || {};

      Object.keys(serverRatings).forEach((subKey) => {
        if (!ratings[subKey]) return; // unknown subsection key -- ignore
        Object.entries(serverRatings[subKey]).forEach(([idxStr, value]) => {
          const idx = Number(idxStr);
          if (idx >= 0 && idx < ratings[subKey].length) {
            ratings[subKey][idx] = value;
          }
        });
      });
    } catch (err) {
      console.error("Failed to load EOPCRF2 data:", err);
    }
    const firstOpen = ORDER.find((o) => !subProgress(o.sub.key).complete);
    if (firstOpen) sel.subKey = firstOpen.sub.key;
    render();
  }

  // `fields` is { rating } -- the server only touches the fields present
  // in the body.
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
  // indicator that currently has a rating.
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
          if (value !== null) {
            clears.push(saveEntry(subKey, idx, { rating: null }));
          }
          ratings[subKey][idx] = null;
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

  // ================= Competency order / progress =================
  // Flat order of the 9 competencies; code is A1..A3 (II-A), B1..B6 (II-B).
  const ORDER = [];
  DATA.forEach((section) => {
    section.subsections.forEach((sub, i) => {
      ORDER.push({
        section,
        sub,
        code: (section.key === "leadership" ? "A" : "B") + (i + 1),
      });
    });
  });

  function subProgress(subKey) {
    const list = ratings[subKey];
    const done = list.filter((v) => v !== null).length;
    return { done, total: list.length, complete: done === list.length };
  }

  function firstIncompleteAfter(subKey) {
    const start = ORDER.findIndex((o) => o.sub.key === subKey);
    for (let step = 1; step <= ORDER.length; step++) {
      const o = ORDER[(start + step) % ORDER.length];
      if (!subProgress(o.sub.key).complete) return o.sub.key;
    }
    return null;
  }

  function ensureSelection() {
    if (ORDER.some((o) => o.sub.key === sel.subKey)) return;
    sel.subKey = ORDER[0].sub.key;
  }

  // ================= Render: progress =================
  function renderProgress() {
    const total = ORDER.length;
    const done = ORDER.filter((o) => subProgress(o.sub.key).complete).length;
    const complete = done === total;
    progressCountEl.classList.toggle("is-complete", complete);
    progressCountEl.innerHTML = `<strong>${done} of ${total}</strong><span>complete</span>`;
    segsEl.setAttribute("aria-valuemax", String(total));
    segsEl.setAttribute("aria-valuenow", String(done));
    segsEl.innerHTML = ORDER.map((o) => {
      const p = subProgress(o.sub.key);
      return `
        <button type="button" class="eopcrf2-seg${o.sub.key === sel.subKey ? " is-active" : ""}${p.complete ? " is-complete" : ""}"
                data-sub="${o.sub.key}" title="${escapeAttr(o.sub.title)}: ${p.done} of ${p.total} rated">
          <span class="eopcrf2-seg-bar"><span style="width:${(p.done / p.total) * 100}%"></span></span>
          <span class="eopcrf2-seg-label">${o.code}</span>
        </button>`;
    }).join("");
    nextBtn.hidden = complete;
    doneBadge.hidden = !complete;
  }

  // ================= Render: list =================
  function renderList() {
    let html = "";
    DATA.forEach((section) => {
      const meta = PART_SHORT[section.key];
      const items = ORDER.filter((o) => o.section === section);
      html += `
        <div class="eopcrf2-list-group">
          <span>${meta.label} &middot; ${escapeHtml(meta.name)}</span>
        </div>`;
      items.forEach((o) => {
        const p = subProgress(o.sub.key);
        const active = o.sub.key === sel.subKey;
        html += `
          <div class="eopcrf2-row${active ? " is-active" : ""}${p.complete ? " is-complete" : ""}">
            <button type="button" class="eopcrf2-row-main" data-action="select-sub" data-sub="${o.sub.key}"${active ? ' aria-current="true"' : ""}>
              <span class="eopcrf2-row-top">
                <span class="eopcrf2-row-text">
                  <span class="eopcrf2-row-name">${escapeHtml(o.sub.title)}</span>
                </span>
                <span class="eopcrf2-row-count">${p.done}/${p.total}</span>
              </span>
              <span class="eopcrf2-row-bar"><span style="width:${(p.done / p.total) * 100}%"></span></span>
            </button>
          </div>`;
      });
    });
    listEl.innerHTML = html;
  }

  // ================= Render: editor =================
  function renderEditor() {
    const idx = ORDER.findIndex((o) => o.sub.key === sel.subKey);
    const { section, sub } = ORDER[idx];
    const meta = PART_SHORT[section.key];
    const actions = confirmClear
      ? `<span class="eopcrf2-ed-ask">Clear this competency?</span>
         <button type="button" class="eopcrf2-ed-del eopcrf2-ed-del--confirm" data-act="clear-yes">Clear</button>
         <button type="button" class="eopcrf2-ed-del" data-act="clear-no">Keep</button>`
      : `<button type="button" class="eopcrf2-ed-del" data-act="clear"><i class="ti ti-eraser" aria-hidden="true"></i> Clear competency</button>`;

    editorEl.innerHTML = `
      <div class="eopcrf2-ed-head">
        <div class="eopcrf2-ed-title">
          <span class="eopcrf2-ed-cat">${meta.label} &middot; ${escapeHtml(meta.name)}</span>
          <span class="eopcrf2-ed-name">${escapeHtml(sub.title)}</span>
        </div>
        <span class="eopcrf2-ed-actions">${actions}</span>
      </div>
      <div class="eopcrf2-ed-body">
        <p class="eopcrf2-part-note">${escapeHtml(section.description)}</p>
        <div class="eopcrf2-crit-list">
          ${sub.criteria.map((text, i) => renderCriterionRow(sub.key, i, text)).join("")}
        </div>
      </div>`;
  }

  function renderCriterionRow(subKey, index, text) {
    const current = ratings[subKey][index];
    const buttons = [1, 2, 3, 4, 5]
      .map(
        (r) =>
          `<button type="button" class="eopcrf2-rate-btn${current === r ? " is-selected" : ""}" data-sub="${subKey}" data-idx="${index}" data-rate="${r}" title="${r} — ${RATING_LABELS[r]}" aria-pressed="${current === r}">${r}</button>`,
      )
      .join("");
    return `
      <div class="eopcrf2-crit${current ? " is-rated" : ""}">
        <span class="eopcrf2-crit-num">${index + 1}</span>
        <span class="eopcrf2-crit-text">${escapeHtml(text)}</span>
        <div class="eopcrf2-rate">
          <div class="eopcrf2-rate-btns" role="group" aria-label="Rating for indicator ${index + 1}">${buttons}</div>
          <span class="eopcrf2-rate-label">${current ? RATING_LABELS[current] : "Not rated"}</span>
        </div>
      </div>`;
  }

  // ================= Render: all =================
  function render() {
    ensureSelection();
    renderProgress();
    renderList();
    renderEditor();
  }

  // ================= Events =================
  function selectSub(subKey, scroll) {
    if (!subKey) return;
    sel.subKey = subKey;
    confirmClear = false;
    render();
    if (scroll)
      workspaceEl.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  segsEl.addEventListener("click", (e) => {
    const seg = e.target.closest(".eopcrf2-seg[data-sub]");
    if (seg) selectSub(seg.dataset.sub, true);
  });

  nextBtn.addEventListener("click", () => {
    selectSub(firstIncompleteAfter(sel.subKey), true);
  });

  listEl.addEventListener("click", (e) => {
    const btn = e.target.closest('[data-action="select-sub"]');
    if (btn) selectSub(btn.dataset.sub, false);
  });

  editorEl.addEventListener("click", (e) => {
    const rateBtn = e.target.closest(".eopcrf2-rate-btn");
    if (rateBtn) {
      const subKey = rateBtn.dataset.sub;
      const idx = parseInt(rateBtn.dataset.idx, 10);
      const rate = parseInt(rateBtn.dataset.rate, 10);
      // Clicking the already-selected rating clears it; otherwise sets it.
      const newValue = ratings[subKey][idx] === rate ? null : rate;
      ratings[subKey][idx] = newValue;
      confirmClear = false;
      render();
      saveEntry(subKey, idx, { rating: newValue });
      return;
    }
    const act = e.target.closest("[data-act]");
    if (!act) return;
    const what = act.dataset.act;
    if (what === "clear-yes") {
      // Clears every indicator of the open competency (best-effort saves).
      ratings[sel.subKey].forEach((value, idx) => {
        if (value !== null) saveEntry(sel.subKey, idx, { rating: null });
        ratings[sel.subKey][idx] = null;
      });
    }
    confirmClear = what === "clear";
    render();
  });

  // ================= Print / Save as PDF =================
  // Builds a print-only copy of Part II (scale, II-A, II-B, signatories) laid
  // out like the OPCRF sheet's page 2, then calls window.print(). Styling is
  // in eopcrf2_print.css (long bond, landscape). The root is moved to <body>
  // so the print stylesheet can hide the rest of the page.
  const printRoot = document.getElementById("eopcrf2-print-root");
  const printBtn = document.getElementById("eopcrf2-print-btn");
  const printCache = { header: {}, authority: { name: "" } };
  if (printRoot) document.body.appendChild(printRoot);

  const SCALE_DEFS = {
    5: "Behavioral indicator is consistently exhibited and is worthy of emulation.",
    4: "Behavioral indicator is constantly shown.",
    3: "Behavioral indicator is often shown.",
    2: "Behavioral indicator is irregularly shown.",
    1: "Behavioral indicator is seldom shown.",
  };

  const pText = (v) => escapeHtml(v == null ? "" : String(v));
  const pNum = (n, digits) =>
    n === null || n === undefined || isNaN(n) ? "" : n.toFixed(digits);

  function printScale() {
    const rows = [5, 4, 3, 2, 1]
      .map(
        (n) =>
          `<tr><td class="q-c">${n}</td><td>${pText(RATING_LABELS[n])}</td><td>${pText(SCALE_DEFS[n])}</td></tr>`,
      )
      .join("");
    return `<div class="q-scale">
      <div class="q-scale-title">DepEd Competencies Scale</div>
      <table class="q-table q-scale-table">
        <colgroup><col style="width:17%"><col style="width:33%"><col style="width:50%"></colgroup>
        <thead><tr><th>Numerical Rating</th><th>Adjectival Rating</th><th>Definition</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }

  function printSection(section) {
    const partLabel = section.title.split(":")[0]; // "Part II-A"
    const secAvg = sectionAverage(section);
    const bodies = section.subsections
      .map((sub) => {
        const n = sub.criteria.length;
        const subAvg = subsectionAverage(sub.key);
        const rows = sub.criteria
          .map((text, i) => {
            const r = ratings[sub.key][i];
            const first =
              i === 0
                ? `<td rowspan="${n}" class="q-comp">${pText(sub.title)}</td>`
                : "";
            const avg =
              i === 0
                ? `<td rowspan="${n}" class="q-c q-avg">${pNum(subAvg, 2)}</td>`
                : "";
            return `<tr>${first}<td>${i + 1}. ${pText(text)}</td><td class="q-c">${r == null ? "" : pText(RATING_LABELS[r])}</td><td class="q-c">${r == null ? "" : r}</td>${avg}</tr>`;
          })
          .join("");
        return `<tbody class="qb-comp">${rows}</tbody>`;
      })
      .join("");
    const total = `<tbody class="qb-total"><tr><td colspan="4" class="q-total-label">${pText(partLabel)} Total Score: Weighted Average (Average x ${WEIGHT})</td><td class="q-c q-total-val">${pNum(weightedScore(secAvg), 4)}</td></tr></tbody>`;
    return `<div class="q-part">
      <h3>${pText(section.title.toUpperCase())}</h3>
      <p class="q-intro">${pText(partLabel)}. ${pText(section.description)}</p>
      <table class="q-table q-main">
        <colgroup><col style="width:9%"><col style="width:61%"><col style="width:13%"><col style="width:7%"><col style="width:10%"></colgroup>
        <thead><tr><th>Competencies</th><th>Behavioural Indicators</th><th>Remarks/ Observations</th><th>RATING</th><th>AVERAGE</th></tr></thead>
        ${bodies}${total}
      </table>
    </div>`;
  }

  function buildPrintHtml() {
    const h = printCache.header || {};
    const a = printCache.authority || {};
    const up = (v) => (v == null ? "" : String(v).toUpperCase());
    const sign = (name, role) =>
      `<div class="q-sign"><div class="q-sign-name">${pText(up(name))}</div><div class="q-sign-role">${role}</div></div>`;
    return `
      <div class="q-top">
        <div class="q-page-label">DepEd OPCRF (ver.Feb2025), page 2 of 4</div>
        ${printScale()}
      </div>
      ${DATA.map(printSection).join("")}
      <div class="q-signs">
        <div class="q-signs-row">${sign(h.nameOfEmployee, "RATEE")}${sign(h.nameOfRater, "RATER")}</div>
        <div class="q-signs-row">${sign(a.name, "APPROVING AUTHORITY")}</div>
      </div>`;
  }

  function refreshPrintRoot() {
    if (printRoot) printRoot.innerHTML = buildPrintHtml();
  }

  // Ratee / Rater / Approving Authority names are the ones kept on EOPCRF I.
  async function loadPrintExtras() {
    const get = async (url) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error("request failed");
      return res.json();
    };
    const [h, a] = await Promise.allSettled([
      get("/api/eopcrf1/report-header"),
      get("/api/eopcrf1/approving-authority"),
    ]);
    if (h.status === "fulfilled") printCache.header = h.value;
    if (a.status === "fulfilled") printCache.authority = a.value;
  }

  if (printBtn && printRoot) {
    printBtn.addEventListener("click", async () => {
      printBtn.disabled = true;
      try {
        await loadPrintExtras();
        refreshPrintRoot();
        window.print();
      } finally {
        printBtn.disabled = false;
      }
    });
    // Ctrl+P / browser menu print gets the same layout from cached data.
    window.addEventListener("beforeprint", refreshPrintRoot);
  }

  // ================= Initial load =================
  loadRatings();
})();
