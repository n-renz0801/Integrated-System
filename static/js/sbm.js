/* SBM - School-Based Management (SBM) Self-Assessment Checklist (Annex A).
   The wording below is copied from the official form. Only the user's
   choices are saved (see /sbm/* routes in app.py). Indicators are numbered
   1-42 in the order they appear here, exactly as on the form. */
(function () {
  "use strict";

  const TITLE =
    "Annex A: School-Based Management (SBM) Self-Assessment Checklist";

  const DEGREES = [
    { key: "not_yet", label: "Not yet manifested" },
    { key: "rarely", label: "Rarely manifested" },
    { key: "frequently", label: "Frequently manifested" },
    { key: "always", label: "Always manifested" },
  ];
  const DEGREE_NOTE = "(Please tick the box that best describes your school)";

  // Trusted constants: <em> / <sup> mirror the italics / superscript on the form.
  const DIMENSIONS = [
    {
      name: "Curriculum and Teaching",
      short: "Curriculum", // label under the progress segment (not form text)
      description:
        "School personnel and stakeholders work collaboratively to enhance learning standards to continually build a relevant and inclusive learning community and achieve improved learning outcomes.",
      indicators: [
        "Grade 3 learners achieve the <em>proficiency level</em> for each cluster of early language, literacy, and numeracy skills",
        "Grade 6,10, and 12 learners achieve the <em>proficiency level</em> in all 21<sup>st</sup>-century skills and core learning areas in the National Achievement Test (NAT)",
        "School-based ALS learners attain certification as elementary and junior high school completers",
        "Teachers prepare contextualized learning materials responsive to the needs of learners",
        "Teachers conduct remediation activities to address learning gaps in reading and comprehension, science and technology, and mathematics",
        "Teachers integrate topics promoting peace and DepEd core values",
        "The school conducts test item analysis to inform its teaching and learning process",
        "The school engages local industries to strengthen its TLE-TVL course offerings",
      ],
    },
    {
      name: "Learning Environment",
      short: "Learning", // label under the progress segment (not form text)
      description:
        "The school and its community work collaboratively to ensure equitable access to a learner-centered, motivating, healthy, safe, secure, inclusive, resilient, and enabling learning environment and to achieve improved learning outcomes.",
      indicators: [
        "The school has zero bullying incidence",
        "The school has zero child abuse incidence",
        "The school has reduced its drop-out incidence",
        "The school conducts culture-sensitive activities",
        "The school provides access to learning experiences for the disadvantaged, OSYs, and adult learners",
        "The school has a functional school-based ALS program",
        "The school has a functional child-protection committee",
        "The school has a functional DRRM plan",
        "The school has a functional support mechanism for mental wellness",
        "The school has special education- and PWD-friendly facilities",
      ],
    },
    {
      name: "Leadership",
      short: "Leadership", // label under the progress segment (not form text)
      description:
        "School personnel and stakeholders are empowered and actively engaged in taking on appropriate leadership roles and responsibilities to continuously improve the school for improved learning outcomes.",
      indicators: [
        "The school develops a strategic plan",
        "The school has a functional school-community planning team",
        "The school has a functional Supreme Student Government/Supreme Pupil Government",
        "The school innovates in its provision of frontline services to stakeholders",
      ],
    },
    {
      name: "Governance and Accountability",
      short: "Governance", // label under the progress segment (not form text)
      description:
        "The school and its community come together to take responsibility for ensuring participation, transparency, and accountability, as well as the implementation of a plan to continuously improve the delivery of basic education services, organizational health, and performance for improved learning outcomes.",
      indicators: [
        "The school\u2019s strategic plan is operationalized an implementation plan",
        "The school has a functional School Governance Council (SGC)",
        "The school has a functional Parent-Teacher Association (PTA)",
        "The school collaborates with stakeholders and other schools in strengthening partnerships",
        "The school monitors and evaluates its programs, projects, and activities",
        "The school maintains an average rating of <em>satisfactory</em> from its internal and external stakeholders",
      ],
    },
    {
      name: "Human Resource and Team Development",
      short: "HR", // label under the progress segment (not form text)
      description:
        "School personnel collaborate to continuously improve individual capabilities and team capacity to create an environment that shall yield high performance for improved learning outcomes.",
      indicators: [
        "School personnel achieve an average rating of <em>very satisfactory</em> in the individual performance commitment and review",
        "The school achieves an average rating of <em>very satisfactory</em> in the office performance commitment and review",
        "The school conducts needs-based Learning Action Cells and Learning &amp; Development activities",
        "The school facilitates the promotion and continuous professional development of its personnel",
        "The school recognizes and rewards milestone achievements of its personnel",
        "The school facilitates receipt of correct salaries, allowances, and other additional compensation in a timely manner",
        "Teacher workload is distributed fairly and equitably",
      ],
    },
    {
      name: "Finance and Resource Management and Mobilization",
      short: "Finance", // label under the progress segment (not form text)
      description:
        "The school judiciously manages and mobilizes resources to support programs, projects, and activities that contribute to the improvement of learning outcomes.",
      indicators: [
        "The school inspects its infrastructure and facilities",
        "The school initiates improvement of its infrastructure and facilities",
        "The school has a functional library",
        "The school has functional water, electric, and internet facilities",
        "The school has a functional computer laboratory/classroom",
        "The school achieves a 75-100% utilization rate of its Maintenance and Other Operating Expenses (MOOE)",
        "The school liquidates 100% of its utilized MOOE",
      ],
    },
  ];

  // Number the indicators 1..42 across dimensions, as on the form.
  let counter = 0;
  DIMENSIONS.forEach((dim) => {
    dim.items = dim.indicators.map((html) => ({ n: ++counter, html }));
  });
  const TOTAL = counter; // 42

  // ================= State =================
  const state = {
    year: null,
    responses: {}, // { "7": { degree: "rarely" | null, remarks: "..." } }
    active: 0, // index into DIMENSIONS
    open: new Set(), // indicator numbers whose Remarks box is expanded
  };

  const el = (id) => document.getElementById(id);
  const navEl = el("sbm-nav");
  const detailEl = el("sbm-detail");
  const workspaceEl = el("sbm-workspace");
  const errorEl = el("sbm-error-state");
  const progressCountEl = el("sbm-progress-count");
  const segsEl = el("sbm-segments");
  const nextBtn = el("sbm-next-unanswered");
  const doneBadge = el("sbm-done-badge");
  const statusEl = el("sbm-save-status");
  const scroller = document.querySelector("main.content");

  // ================= Helpers =================
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function apiCall(method, url, body) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch(url, opts);
    } catch (e) {
      throw new Error("Network error. Check your connection and try again.");
    }
    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      /* no JSON body */
    }
    if (!res.ok) {
      throw new Error(
        (data && data.error) || "Something went wrong. Please try again.",
      );
    }
    return data;
  }

  function resp(n) {
    const key = String(n);
    if (!state.responses[key])
      state.responses[key] = { degree: null, remarks: "" };
    return state.responses[key];
  }

  function answeredIn(dim) {
    return dim.items.filter((it) => resp(it.n).degree).length;
  }

  function answeredTotal() {
    return DIMENSIONS.reduce((sum, d) => sum + answeredIn(d), 0);
  }

  // Only failures are reported (under the count); successful saves are silent.
  function setStatus(kind, message) {
    const isError = kind === "error";
    statusEl.classList.toggle("is-error", isError);
    statusEl.textContent = isError ? "Couldn\u2019t save: " + message : "";
  }

  async function save(n, patch) {
    setStatus("saving");
    try {
      await apiCall("POST", "/sbm/response", {
        year: state.year,
        indicatorNo: n,
        ...patch,
      });
      setStatus("saved");
    } catch (err) {
      setStatus("error", err.message);
      throw err;
    }
  }

  // ================= Rendering =================
  function renderProgress() {
    const done = answeredTotal();
    const complete = done === TOTAL;
    progressCountEl.classList.toggle("is-complete", complete);
    progressCountEl.innerHTML = `<strong>${done} of ${TOTAL}</strong><span>answered</span>`;
    segsEl.setAttribute("aria-valuenow", String(done));
    segsEl.innerHTML = DIMENSIONS.map((dim, i) => {
      const d = answeredIn(dim);
      const t = dim.items.length;
      return `
        <button type="button" class="sbm-seg${i === state.active ? " is-active" : ""}${d === t ? " is-complete" : ""}"
                data-dim="${i}" title="${escapeHtml(dim.name)}: ${d} of ${t}">
          <span class="sbm-seg-bar"><span style="width:${(d / t) * 100}%"></span></span>
          <span class="sbm-seg-label">${escapeHtml(dim.short)}</span>
        </button>`;
    }).join("");
    // Once everything is answered, the shortcut gives way to a status badge.
    nextBtn.hidden = complete;
    doneBadge.hidden = !complete;
  }

  function renderNav() {
    navEl.innerHTML = DIMENSIONS.map((dim, i) => {
      const done = answeredIn(dim);
      const total = dim.items.length;
      const complete = done === total;
      return `
        <button type="button" class="sbm-nav-item${i === state.active ? " is-active" : ""}${complete ? " is-complete" : ""}"
                data-dim="${i}" ${i === state.active ? 'aria-current="true"' : ""}>
          <span class="sbm-nav-top">
            <span class="sbm-nav-name">${escapeHtml(dim.name)}</span>
            <span class="sbm-nav-count">${
              complete
                ? '<i class="ti ti-circle-check-filled" aria-hidden="true"></i>'
                : ""
            }${done} of ${total}</span>
          </span>
          <span class="sbm-nav-bar"><span style="width:${(done / total) * 100}%"></span></span>
        </button>`;
    }).join("");
  }

  function optionsHtml(n, selected) {
    return DEGREES.map(
      (d) => `
        <button type="button" class="sbm-opt${selected === d.key ? " is-selected" : ""}"
                role="radio" aria-checked="${selected === d.key}" data-degree="${d.key}">
          <span class="sbm-box" aria-hidden="true"></span>
          <span class="sbm-opt-label">${d.label}</span>
        </button>`,
    ).join("");
  }

  function cardHtml(item) {
    const r = resp(item.n);
    const hasRemarks = !!r.remarks;
    const isOpen = state.open.has(item.n) || hasRemarks;
    if (hasRemarks) state.open.add(item.n);
    return `
      <article class="sbm-card${r.degree ? " is-answered" : ""}" data-n="${item.n}" id="sbm-card-${item.n}">
        <div class="sbm-card-main">
          <p class="sbm-indicator"><span class="sbm-no">${item.n}.</span><span class="sbm-indicator-text">${item.html}</span></p>
          <div class="sbm-opts" role="radiogroup" aria-label="Degree of Manifestation for indicator ${item.n}">
            ${optionsHtml(item.n, r.degree)}
          </div>
        </div>
        <div class="sbm-card-foot">
          <button type="button" class="sbm-link sbm-remarks-toggle" aria-expanded="${isOpen}">
            <i class="ti ${isOpen ? "ti-chevron-down" : "ti-message-plus"}" aria-hidden="true"></i>
            <span class="sbm-remarks-toggle-text">${hasRemarks || isOpen ? "Remarks" : "Add remarks"}</span>
            <span class="sbm-dot" ${hasRemarks && !isOpen ? "" : "hidden"} aria-hidden="true"></span>
          </button>
          <button type="button" class="sbm-link sbm-clear" ${r.degree ? "" : "hidden"}>
            <i class="ti ti-x" aria-hidden="true"></i> Clear
          </button>
        </div>
        <div class="sbm-remarks" ${isOpen ? "" : "hidden"}>
          <textarea rows="3" aria-label="Remarks for indicator ${item.n}">${escapeHtml(r.remarks)}</textarea>
        </div>
      </article>`;
  }

  function renderDetail() {
    const dim = DIMENSIONS[state.active];
    const prev = DIMENSIONS[state.active - 1];
    const next = DIMENSIONS[state.active + 1];
    detailEl.innerHTML = `
      <div class="sbm-dim-head">
        <h3>${escapeHtml(dim.name)}</h3>
        <p>${escapeHtml(dim.description)}</p>
      </div>
      <div class="sbm-cols" aria-hidden="true">
        <span>SBM Indicator</span>
        <span class="sbm-cols-degree"><strong>Degree of Manifestation</strong><small>${DEGREE_NOTE}</small></span>
      </div>
      <div class="sbm-cards">${dim.items.map(cardHtml).join("")}</div>
      <div class="sbm-pager">
        ${
          prev
            ? `<button type="button" class="sbm-btn" data-go="${state.active - 1}"><i class="ti ti-arrow-left" aria-hidden="true"></i> ${escapeHtml(prev.name)}</button>`
            : "<span></span>"
        }
        ${
          next
            ? `<button type="button" class="sbm-btn sbm-btn--primary" data-go="${state.active + 1}">${escapeHtml(next.name)} <i class="ti ti-arrow-right" aria-hidden="true"></i></button>`
            : "<span></span>"
        }
      </div>`;
    detailEl.querySelectorAll("textarea").forEach(autoGrow);
  }

  function autoGrow(ta) {
    ta.style.height = "auto";
    ta.style.height = Math.max(ta.scrollHeight + 2, 72) + "px";
  }

  // Update one card in place (keeps keyboard focus / typing intact).
  function updateCard(n) {
    const card = el("sbm-card-" + n);
    if (!card) return;
    const r = resp(n);
    card.classList.toggle("is-answered", !!r.degree);
    card.querySelectorAll(".sbm-opt").forEach((btn) => {
      const on = btn.dataset.degree === r.degree;
      btn.classList.toggle("is-selected", on);
      btn.setAttribute("aria-checked", String(on));
    });
    card.querySelector(".sbm-clear").hidden = !r.degree;
  }

  function refreshCounts() {
    renderProgress();
    renderNav();
  }

  function goToDimension(i, opts = {}) {
    state.active = i;
    renderProgress();
    renderNav();
    renderDetail();
    if (!opts.keepScroll && scroller) scroller.scrollTo({ top: 0 });
  }

  // ================= Events =================
  segsEl.addEventListener("click", (e) => {
    const seg = e.target.closest(".sbm-seg");
    if (seg) goToDimension(Number(seg.dataset.dim));
  });

  navEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".sbm-nav-item");
    if (btn) goToDimension(Number(btn.dataset.dim));
  });

  const saveTimers = {};
  function flushRemarks(n) {
    if (saveTimers[n] === undefined) return;
    clearTimeout(saveTimers[n]);
    delete saveTimers[n];
    save(n, { remarks: resp(n).remarks }).catch(() => {});
  }

  detailEl.addEventListener("click", (e) => {
    const go = e.target.closest("[data-go]");
    if (go) return goToDimension(Number(go.dataset.go));

    const card = e.target.closest(".sbm-card");
    if (!card) return;
    const n = Number(card.dataset.n);

    const opt = e.target.closest(".sbm-opt");
    if (opt) {
      const r = resp(n);
      const previous = r.degree;
      const next = previous === opt.dataset.degree ? null : opt.dataset.degree;
      r.degree = next;
      updateCard(n);
      refreshCounts();
      save(n, { degree: next }).catch(() => {
        r.degree = previous;
        updateCard(n);
        refreshCounts();
      });
      return;
    }

    if (e.target.closest(".sbm-clear")) {
      const r = resp(n);
      const previous = r.degree;
      r.degree = null;
      updateCard(n);
      refreshCounts();
      save(n, { degree: null }).catch(() => {
        r.degree = previous;
        updateCard(n);
        refreshCounts();
      });
      return;
    }

    if (e.target.closest(".sbm-remarks-toggle")) {
      const box = card.querySelector(".sbm-remarks");
      const nowOpen = box.hidden; // it's about to open
      box.hidden = !nowOpen;
      if (nowOpen) state.open.add(n);
      else state.open.delete(n);
      const btn = card.querySelector(".sbm-remarks-toggle");
      const hasText = !!resp(n).remarks;
      btn.setAttribute("aria-expanded", String(nowOpen));
      btn.querySelector("i").className =
        "ti " + (nowOpen ? "ti-chevron-down" : "ti-message-plus");
      btn.querySelector(".sbm-remarks-toggle-text").textContent =
        nowOpen || hasText ? "Remarks" : "Add remarks";
      btn.querySelector(".sbm-dot").hidden = nowOpen || !hasText;
      if (nowOpen) {
        const ta = box.querySelector("textarea");
        autoGrow(ta);
        ta.focus();
      }
    }
  });

  detailEl.addEventListener("input", (e) => {
    const ta = e.target.closest("textarea");
    if (!ta) return;
    const n = Number(ta.closest(".sbm-card").dataset.n);
    resp(n).remarks = ta.value;
    autoGrow(ta);
    clearTimeout(saveTimers[n]);
    saveTimers[n] = setTimeout(() => flushRemarks(n), 700);
  });

  detailEl.addEventListener("focusout", (e) => {
    const ta = e.target.closest && e.target.closest("textarea");
    if (ta) flushRemarks(Number(ta.closest(".sbm-card").dataset.n));
  });

  // Go to the first indicator with no degree selected.
  nextBtn.addEventListener("click", () => {
    for (let d = 0; d < DIMENSIONS.length; d++) {
      const item = DIMENSIONS[d].items.find((it) => !resp(it.n).degree);
      if (!item) continue;
      if (d !== state.active) goToDimension(d, { keepScroll: true });
      const card = el("sbm-card-" + item.n);
      if (card) {
        const calm = window.matchMedia(
          "(prefers-reduced-motion: reduce)",
        ).matches;
        card.scrollIntoView({
          block: "center",
          behavior: calm ? "auto" : "smooth",
        });
        card.classList.remove("is-flash");
        void card.offsetWidth; // restart the highlight animation
        card.classList.add("is-flash");
      }
      return;
    }
  });

  // ================= Reset =================
  const overlay = el("sbm-reset-confirm-overlay");
  const openReset = () => overlay.classList.add("visible");
  const closeReset = () => overlay.classList.remove("visible");
  el("sbm-reset-btn").addEventListener("click", openReset);
  el("sbm-reset-confirm-cancel").addEventListener("click", closeReset);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeReset();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeReset();
  });
  el("sbm-reset-confirm-confirm").addEventListener("click", async () => {
    try {
      await apiCall("DELETE", "/sbm/reset?year=" + state.year);
      Object.keys(saveTimers).forEach((k) => {
        clearTimeout(saveTimers[k]);
        delete saveTimers[k];
      });
      state.responses = {};
      state.open.clear();
      closeReset();
      renderProgress();
      renderNav();
      renderDetail();
      setStatus("saved");
    } catch (err) {
      closeReset();
      setStatus("error", err.message);
    }
  });

  // ================= Print copy (mirrors the original Annex A form) =================
  const printRoot = el("sbm-print-root");
  const printBtn = el("sbm-print-btn");
  if (printRoot) document.body.appendChild(printRoot);

  function buildPrintHtml() {
    const intro = el("sbm-intro").innerHTML;
    const tables = DIMENSIONS.map((dim) => {
      const rows = dim.items
        .map((it) => {
          const r = resp(it.n);
          const boxes = DEGREES.map(
            (d) =>
              `<td class="sp-tick"><span class="sp-box">${r.degree === d.key ? "&#10003;" : ""}</span></td>`,
          ).join("");
          return `<tr>
            <td class="sp-ind"><span class="sp-no">${it.n}.</span><span class="sp-ind-text">${it.html}</span></td>
            ${boxes}
            <td class="sp-rem">${escapeHtml(r.remarks)}</td>
          </tr>`;
        })
        .join("");
      return `
        <table class="sp-table">
          <colgroup><col style="width:38%"><col style="width:11%"><col style="width:11%"><col style="width:11%"><col style="width:11%"><col style="width:18%"></colgroup>
          <thead>
            <tr><th colspan="6" class="sp-dim"><strong>${escapeHtml(dim.name)}</strong><span>${escapeHtml(dim.description)}</span></th></tr>
            <tr>
              <th rowspan="2" class="sp-col-ind">SBM Indicator</th>
              <th colspan="4" class="sp-col-deg">Degree of Manifestation<small>${DEGREE_NOTE}</small></th>
              <th rowspan="2" class="sp-col-rem">Remarks</th>
            </tr>
            <tr>${DEGREES.map((d) => `<th class="sp-col-opt">${d.label}</th>`).join("")}</tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>`;
    }).join("");
    return `<div class="sp-sheet">
      <h1 class="sp-title">${TITLE}</h1>
      <p class="sp-intro">${intro}</p>
      ${tables}
    </div>`;
  }

  function refreshPrintRoot() {
    printRoot.innerHTML = buildPrintHtml();
  }

  if (printBtn && printRoot) {
    let builtForButton = false;
    printBtn.addEventListener("click", () => {
      // Make sure any remark still being typed is in the state first.
      Object.keys(saveTimers).forEach((k) => flushRemarks(Number(k)));
      const restore = () => {
        builtForButton = false;
        window.removeEventListener("afterprint", restore);
      };
      window.addEventListener("afterprint", restore);
      refreshPrintRoot();
      builtForButton = true;
      window.print();
    });
    // Ctrl+P / browser menu print gets the same layout.
    window.addEventListener("beforeprint", () => {
      if (!builtForButton) refreshPrintRoot();
    });
  }

  // ================= Initial load =================
  async function init() {
    renderProgress();
    renderNav();
    renderDetail();
    try {
      const data = await apiCall("GET", "/sbm/data");
      state.year = data.year;
      Object.entries(data.responses || {}).forEach(([n, r]) => {
        state.responses[n] = {
          degree: r.degree || null,
          remarks: r.remarks || "",
        };
      });
      renderProgress();
      renderNav();
      renderDetail();
    } catch (err) {
      workspaceEl.style.display = "none";
      errorEl.style.display = "block";
      errorEl.textContent = "Couldn\u2019t load this checklist: " + err.message;
    }
  }

  init();
})();
