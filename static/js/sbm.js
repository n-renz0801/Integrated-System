/* SBM - School-Based Management (SBM) Self-Assessment Checklist (Annex A).
   The wording below is copied from the official form. Only the user's
   choices are saved (see /sbm/* routes in app.py). Indicators are numbered
   1-42 in the order they appear here, exactly as on the form. */
(function () {
  "use strict";

  const TITLE =
    "Annex A: School-Based Management (SBM) Self-Assessment Checklist";

  const DEGREES = [
    { key: "not_yet", label: "Not yet manifested", short: "Not yet" },
    { key: "rarely", label: "Rarely manifested", short: "Rarely" },
    { key: "frequently", label: "Frequently manifested", short: "Frequently" },
    { key: "always", label: "Always manifested", short: "Always" },
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
    responses: {}, // { "7": { degree: "rarely" | null, remarks: "...", movLink: "https://..." } }
    active: 0, // index into DIMENSIONS
    open: new Set(), // indicator numbers whose Remarks box is expanded
    mov: {}, // { "7": "edit" | "confirm" } transient MOV-link UI mode per indicator
    confirmClear: false, // "Clear section" is waiting for Clear / Keep
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
      state.responses[key] = { degree: null, remarks: "", movLink: "" };
    return state.responses[key];
  }

  // An indicator is finished only when it has a degree AND a MOV link.
  function isComplete(n) {
    const r = resp(n);
    return !!(r.degree && r.movLink);
  }

  function answeredIn(dim) {
    return dim.items.filter((it) => isComplete(it.n)).length;
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
    progressCountEl.innerHTML = `<strong>${done} of ${TOTAL}</strong><span>complete</span>`;
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
      const isDone = done === total;
      return `
        <button type="button" class="sbm-nav-item${i === state.active ? " is-active" : ""}${isDone ? " is-complete" : ""}"
                data-dim="${i}" ${i === state.active ? 'aria-current="true"' : ""}>
          <span class="sbm-nav-top">
            <span class="sbm-nav-name">${escapeHtml(dim.name)}</span>
            <span class="sbm-nav-count">${isDone ? '<i class="ti ti-circle-check-filled" aria-hidden="true"></i>' : ""}${done}/${total}</span>
          </span>
          <span class="sbm-nav-bar" aria-hidden="true"><span style="width:${(done / total) * 100}%"></span></span>
        </button>`;
    }).join("");
  }

  function optionsHtml(n, selected) {
    // Roving tabindex: one tab stop per row (the chosen option, else the first).
    const stop = DEGREES.some((d) => d.key === selected)
      ? selected
      : DEGREES[0].key;
    return DEGREES.map(
      (d, i) => `
        <button type="button" class="sbm-opt${selected === d.key ? " is-selected" : ""}"
                role="radio" aria-checked="${selected === d.key}" data-degree="${d.key}"
                tabindex="${d.key === stop ? 0 : -1}" title="${d.label} (press ${i + 1})"
                aria-label="${d.label}">
          <span class="sbm-opt-label" aria-hidden="true">${d.short}</span>
        </button>`,
    ).join("");
  }

  // ================= MOV link =================
  const MOV_MAX = 2000;

  // Accepts what people actually paste: adds https:// when no scheme is given.
  function normalizeMovUrl(raw) {
    let v = String(raw || "").trim();
    if (!v) return { error: "Paste the link to your evidence." };
    if (/\s/.test(v)) return { error: "A link can\u2019t contain spaces." };
    if (/^[a-z][a-z0-9+.-]*:(?!\/\/|\d)/i.test(v))
      return { error: "Use a link that starts with http:// or https://." };
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) v = "https://" + v;
    let u;
    try {
      u = new URL(v);
    } catch (e) {
      return { error: "That doesn\u2019t look like a valid link." };
    }
    if (u.protocol !== "http:" && u.protocol !== "https:")
      return { error: "Use a link that starts with http:// or https://." };
    if (!u.hostname.includes(".") && u.hostname !== "localhost")
      return { error: "That doesn\u2019t look like a valid link." };
    if (v.length > MOV_MAX)
      return {
        error: "That link is too long (max " + MOV_MAX + " characters).",
      };
    return { url: v };
  }

  // Long links: only the host is shown; the full address is on the tooltip
  // and opens on click.
  function splitMovUrl(url) {
    try {
      const u = new URL(url);
      let rest = u.pathname + u.search + u.hash;
      if (rest === "/") rest = "";
      return { host: u.host, rest };
    } catch (e) {
      return { host: url, rest: "" };
    }
  }

  function movHtml(n) {
    const link = resp(n).movLink;
    const mode = state.mov[n];
    if (!link || mode === "edit") {
      const verb = link ? "Save" : "Attach";
      return `
        <div class="sbm-mov${link ? "" : " is-missing"}">
          <input type="text" inputmode="url" class="sbm-mov-input" value="${escapeHtml(link)}"
                 placeholder="Paste your MOV link here (required)" autocomplete="off" spellcheck="false"
                 aria-label="MOV link for indicator ${n}" />
          <button type="button" class="sbm-mov-btn sbm-mov-btn--primary sbm-mov-save" ${link ? "" : "disabled"}>${verb}</button>
          ${link ? '<button type="button" class="sbm-mov-btn sbm-mov-cancel">Cancel</button>' : ""}
          <span class="sbm-mov-err" role="alert" hidden></span>
        </div>`;
    }
    const { host } = splitMovUrl(link);
    const safe = /^https?:\/\//i.test(link);
    const inner = `
      <span class="sbm-mov-ico"><i class="ti ti-link" aria-hidden="true"></i></span>
      <span class="sbm-mov-host">${escapeHtml(host)}</span>
      ${safe ? '<i class="ti ti-external-link sbm-mov-ext" aria-hidden="true"></i>' : ""}`;
    const tile = safe
      ? `<a class="sbm-mov-tile" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(link)}" aria-label="Open MOV link for indicator ${n}: ${escapeHtml(host)} (opens in a new tab)">${inner}</a>`
      : `<span class="sbm-mov-tile" title="${escapeHtml(link)}">${inner}</span>`;
    const actions =
      mode === "confirm"
        ? `<span class="sbm-mov-ask">Remove this link?</span>
           <button type="button" class="sbm-mov-btn sbm-mov-btn--danger sbm-mov-remove-yes">Remove</button>
           <button type="button" class="sbm-mov-btn sbm-mov-remove-no">Keep</button>`
        : `<span class="sbm-mov-tools">
             <button type="button" class="sbm-mov-icon sbm-mov-edit" aria-label="Edit MOV link for indicator ${n}" title="Edit link"><i class="ti ti-pencil" aria-hidden="true"></i></button>
             <button type="button" class="sbm-mov-icon sbm-mov-icon--danger sbm-mov-remove" aria-label="Remove MOV link for indicator ${n}" title="Remove link"><i class="ti ti-trash" aria-hidden="true"></i></button>
           </span>`;
    return `<div class="sbm-mov">${tile}${actions}</div>`;
  }

  // First non-empty line of a remark, shown beside the toggle when collapsed.
  function remarksSnippet(text) {
    const line = String(text || "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find(Boolean);
    return line || "";
  }

  // Inside of the whole-line Remarks toggle. Used by the first render and by
  // the click handler, so both always show the same thing.
  function remarksToggleInner(n, isOpen) {
    const text = resp(n).remarks;
    const has = !!text.trim();
    const snippet = !isOpen && has ? remarksSnippet(text) : "";
    return `
      <i class="ti ${has ? "ti-message-circle-filled" : "ti-message-plus"} sbm-remarks-icon" aria-hidden="true"></i>
      <span class="sbm-remarks-toggle-text">${has || isOpen ? "Remarks" : "Add remarks"}</span>
      <span class="sbm-remarks-snippet"${snippet ? "" : " hidden"}>${escapeHtml(snippet)}</span>
      <span class="sbm-remarks-act">${isOpen ? "Close" : has ? "Edit" : ""}</span>`;
  }

  function cardHtml(item) {
    const r = resp(item.n);
    const hasRemarks = !!r.remarks.trim();
    const isOpen = state.open.has(item.n);
    return `
      <article class="sbm-card${isComplete(item.n) ? " is-complete" : ""}" data-n="${item.n}" id="sbm-card-${item.n}">
        <p class="sbm-indicator"><span class="sbm-no">${item.n}</span><span class="sbm-indicator-text">${item.html}</span></p>
        <div class="sbm-bar">
          <div class="sbm-opts" role="radiogroup" aria-label="Degree of Manifestation for indicator ${item.n}">
            ${optionsHtml(item.n, r.degree)}
          </div>
          ${movHtml(item.n)}
        </div>
        <div class="sbm-remarks-row">
          <button type="button" class="sbm-remarks-toggle${hasRemarks ? " has-remarks" : ""}" aria-expanded="${isOpen}">
            ${remarksToggleInner(item.n, isOpen)}
          </button>
          <div class="sbm-remarks" ${isOpen ? "" : "hidden"}>
            <textarea rows="1" aria-label="Remarks for indicator ${item.n}">${escapeHtml(r.remarks)}</textarea>
          </div>
        </div>
      </article>`;
  }

  // Banner actions: clear this dimension (two steps, like Clear row on OPCRF IV).
  function dimActionsHtml() {
    return state.confirmClear
      ? `<span class="sbm-dim-ask">Clear this section?</span>
         <button type="button" class="sbm-dim-del sbm-dim-del--confirm" data-act="clear-yes">Clear</button>
         <button type="button" class="sbm-dim-del" data-act="clear-no">Keep</button>`
      : `<button type="button" class="sbm-dim-del" data-act="clear"><i class="ti ti-eraser" aria-hidden="true"></i> Clear section</button>`;
  }

  function renderDetail() {
    const dim = DIMENSIONS[state.active];
    detailEl.innerHTML = `
      <div class="sbm-dim-head">
        <div class="sbm-dim-text">
          <h3>${escapeHtml(dim.name)}</h3>
          <p>${escapeHtml(dim.description)}</p>
        </div>
        <div class="sbm-dim-actions">${dimActionsHtml()}</div>
      </div>
      <div class="sbm-cards">${dim.items.map(cardHtml).join("")}</div>`;
    detailEl.querySelectorAll("textarea").forEach(autoGrow);
  }

  function autoGrow(ta) {
    ta.style.height = "auto";
    ta.style.height = Math.max(ta.scrollHeight + 2, 44) + "px";
  }

  // Update one card in place (keeps keyboard focus / typing intact).
  function updateCard(n) {
    const card = el("sbm-card-" + n);
    if (!card) return;
    const r = resp(n);
    card.classList.toggle("is-complete", isComplete(n));
    const opts = Array.from(card.querySelectorAll(".sbm-opt"));
    const stop = opts.some((b) => b.dataset.degree === r.degree)
      ? r.degree
      : opts[0].dataset.degree;
    opts.forEach((btn) => {
      const on = btn.dataset.degree === r.degree;
      btn.classList.toggle("is-selected", on);
      btn.setAttribute("aria-checked", String(on));
      btn.tabIndex = btn.dataset.degree === stop ? 0 : -1;
    });
  }

  // Choose (or clear, when it is already chosen) the degree for one indicator.
  function setDegree(n, key) {
    const r = resp(n);
    const previous = r.degree;
    const next = previous === key ? null : key;
    r.degree = next;
    updateCard(n);
    refreshCounts();
    save(n, { degree: next }).catch(() => {
      r.degree = previous;
      updateCard(n);
      refreshCounts();
    });
  }

  function focusCardOptions(card) {
    if (!card) return;
    const target =
      card.querySelector('.sbm-opt[tabindex="0"]') ||
      card.querySelector(".sbm-opt");
    if (target) target.focus();
  }

  function refreshCounts() {
    renderProgress();
    renderNav();
  }

  function goToDimension(i, opts = {}) {
    state.active = i;
    state.confirmClear = false;
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

  // ================= Clear section =================
  // Empties the degree, remarks and MOV link of every indicator in the open
  // dimension. Two steps: Clear section, then Clear / Keep.
  async function handleSectionAction(what) {
    const box = detailEl.querySelector(".sbm-dim-actions");
    if (!box) return;
    if (what === "clear" || what === "clear-no") {
      state.confirmClear = what === "clear";
      box.innerHTML = dimActionsHtml();
      const next = box.querySelector(
        what === "clear" ? '[data-act="clear-no"]' : '[data-act="clear"]',
      );
      if (next) next.focus();
    } else if (what === "clear-yes") {
      await clearSection();
    }
  }

  async function clearSection() {
    const nums = DIMENSIONS[state.active].items.map((it) => it.n);
    nums.forEach((n) => {
      if (saveTimers[n] !== undefined) {
        clearTimeout(saveTimers[n]);
        delete saveTimers[n];
      }
    });
    setStatus("saving");
    try {
      await apiCall("POST", "/sbm/clear-section", {
        year: state.year,
        indicatorNos: nums,
      });
      nums.forEach((n) => {
        delete state.responses[String(n)];
        delete state.mov[n];
        state.open.delete(n);
      });
      state.confirmClear = false;
      refreshCounts();
      renderDetail();
      setStatus("saved");
    } catch (err) {
      state.confirmClear = false;
      const box = detailEl.querySelector(".sbm-dim-actions");
      if (box) box.innerHTML = dimActionsHtml();
      setStatus("error", err.message);
    }
  }

  detailEl.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]");
    if (act) return handleSectionAction(act.dataset.act);

    const card = e.target.closest(".sbm-card");
    if (!card) return;
    const n = Number(card.dataset.n);

    if (e.target.closest(".sbm-mov")) return handleMovClick(n, e);

    const opt = e.target.closest(".sbm-opt");
    if (opt) return setDegree(n, opt.dataset.degree);

    if (e.target.closest(".sbm-remarks-toggle")) {
      const box = card.querySelector(".sbm-remarks");
      const nowOpen = box.hidden; // it's about to open
      box.hidden = !nowOpen;
      if (nowOpen) state.open.add(n);
      else state.open.delete(n);
      const btn = card.querySelector(".sbm-remarks-toggle");
      btn.setAttribute("aria-expanded", String(nowOpen));
      btn.classList.toggle("has-remarks", !!resp(n).remarks.trim());
      btn.innerHTML = remarksToggleInner(n, nowOpen);
      if (nowOpen) {
        const ta = box.querySelector("textarea");
        autoGrow(ta);
        ta.focus();
      }
    }
  });

  detailEl.addEventListener("input", (e) => {
    const movInput = e.target.closest(".sbm-mov-input");
    if (movInput) {
      const strip = movInput.closest(".sbm-mov");
      showMovError(strip, "");
      if (strip.classList.contains("is-missing"))
        strip.querySelector(".sbm-mov-save").disabled = !movInput.value.trim();
      return;
    }
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

  // ---- MOV link actions ----
  function movEl(n) {
    const card = el("sbm-card-" + n);
    return card && card.querySelector(".sbm-mov");
  }
  function rerenderMov(n) {
    const old = movEl(n);
    if (old) old.outerHTML = movHtml(n);
    return movEl(n);
  }
  function showMovError(strip, msg) {
    const err = strip.querySelector(".sbm-mov-err");
    const input = strip.querySelector(".sbm-mov-input");
    err.textContent = msg;
    err.hidden = !msg;
    input.setAttribute("aria-invalid", msg ? "true" : "false");
  }
  function setMov(n, value) {
    const r = resp(n);
    const previous = r.movLink;
    r.movLink = value;
    delete state.mov[n];
    const strip = rerenderMov(n);
    updateCard(n);
    refreshCounts();
    const focusTarget = value
      ? strip.querySelector(".sbm-mov-edit")
      : strip.querySelector(".sbm-mov-input");
    if (focusTarget) focusTarget.focus();
    save(n, { movLink: value }).catch(() => {
      r.movLink = previous;
      rerenderMov(n);
      updateCard(n);
      refreshCounts();
    });
  }
  function commitMov(n) {
    const strip = movEl(n);
    const input = strip.querySelector(".sbm-mov-input");
    const res = normalizeMovUrl(input.value);
    if (res.error) {
      showMovError(strip, res.error);
      input.focus();
      return;
    }
    if (res.url === resp(n).movLink) {
      delete state.mov[n];
      rerenderMov(n).querySelector(".sbm-mov-edit").focus();
      return;
    }
    setMov(n, res.url);
  }
  function cancelMov(n) {
    delete state.mov[n];
    const strip = rerenderMov(n);
    const edit = strip.querySelector(".sbm-mov-edit");
    if (edit) edit.focus();
  }
  function handleMovClick(n, e) {
    const btn = e.target.closest("button");
    if (!btn) return; // the link tile itself just opens normally
    const has = (c) => btn.classList.contains(c);
    if (has("sbm-mov-save")) return commitMov(n);
    if (has("sbm-mov-cancel")) return cancelMov(n);
    if (has("sbm-mov-edit")) {
      state.mov[n] = "edit";
      const input = rerenderMov(n).querySelector(".sbm-mov-input");
      input.focus();
      input.select();
      return;
    }
    if (has("sbm-mov-remove")) {
      state.mov[n] = "confirm";
      rerenderMov(n).querySelector(".sbm-mov-remove-no").focus();
      return;
    }
    if (has("sbm-mov-remove-no")) {
      delete state.mov[n];
      rerenderMov(n).querySelector(".sbm-mov-remove").focus();
      return;
    }
    if (has("sbm-mov-remove-yes")) return setMov(n, "");
  }

  detailEl.addEventListener("keydown", (e) => {
    const input = e.target.closest && e.target.closest(".sbm-mov-input");
    if (!input) return;
    const n = Number(input.closest(".sbm-card").dataset.n);
    if (e.key === "Enter") {
      e.preventDefault();
      commitMov(n);
    } else if (e.key === "Escape" && resp(n).movLink) {
      e.preventDefault();
      cancelMov(n);
    }
  });

  detailEl.addEventListener("keydown", (e) => {
    const opt = e.target.closest && e.target.closest(".sbm-opt");
    if (!opt || e.altKey || e.ctrlKey || e.metaKey) return;
    const card = opt.closest(".sbm-card");
    const n = Number(card.dataset.n);
    const opts = Array.from(card.querySelectorAll(".sbm-opt"));
    const i = opts.indexOf(opt);
    if (e.key >= "1" && e.key <= String(DEGREES.length)) {
      e.preventDefault();
      setDegree(n, DEGREES[Number(e.key) - 1].key);
      focusCardOptions(el("sbm-card-" + (n + 1))); // keep going down the list
    } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const to = opts[i + (e.key === "ArrowRight" ? 1 : -1)];
      if (to) to.focus();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      focusCardOptions(
        el("sbm-card-" + (n + (e.key === "ArrowDown" ? 1 : -1))),
      );
    }
  });

  // Go to the first indicator that isn't finished yet (no degree or no link).
  nextBtn.addEventListener("click", () => {
    for (let d = 0; d < DIMENSIONS.length; d++) {
      const item = DIMENSIONS[d].items.find((it) => !isComplete(it.n));
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
    if (e.key === "Escape") {
      closeReset();
      closeDrawer();
    }
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
      state.mov = {};
      state.confirmClear = false;
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

  // School details for the top of the printout. They are typed in the "School
  // details" panel at the top of this page and saved through /sbm/school-info
  // (independent of OPCRF I's Form details). `schoolInfo` always mirrors the
  // inputs, so Ctrl+P (which can't wait for a request) prints what is on screen.
  const schoolInfo = { school: "", head: "", year: "" };
  const schoolOpenBtn = el("sbm-school-open");
  const schoolSumEl = el("sbm-school-sum");
  const schoolStatusEl = el("sbm-school-status");
  const schoolInputs = Array.from(document.querySelectorAll("[data-school]"));
  const schoolTimers = {};

  function syncSchoolInfo() {
    const v = (key) =>
      (schoolInputs.find((i) => i.dataset.school === key).value || "").trim();
    schoolInfo.school = v("schoolName").toUpperCase();
    schoolInfo.head = v("schoolHead").toUpperCase();
    schoolInfo.year = v("schoolYear");
    const bits = [schoolInfo.school, schoolInfo.head, schoolInfo.year].filter(
      Boolean,
    );
    const missing = bits.length < 3;
    schoolSumEl.textContent = !bits.length
      ? "Not filled in yet"
      : bits.join(" \u00b7 ") + (missing ? " (incomplete)" : "");
    schoolSumEl.classList.toggle("is-incomplete", missing);
    schoolOpenBtn.textContent = bits.length
      ? "Edit school details"
      : "Add school details";
  }

  function setSchoolStatus(message) {
    schoolStatusEl.classList.toggle("is-error", !!message);
    schoolStatusEl.textContent = message
      ? "Couldn\u2019t save: " + message
      : "";
  }

  async function saveSchoolField(input) {
    const key = input.dataset.school;
    clearTimeout(schoolTimers[key]);
    delete schoolTimers[key];
    try {
      await apiCall("POST", "/sbm/school-info", { [key]: input.value });
      setSchoolStatus("");
    } catch (err) {
      setSchoolStatus(err.message);
    }
  }

  // Save anything still waiting on its typing delay (used before printing).
  async function flushSchool() {
    const pending = schoolInputs.filter(
      (i) => schoolTimers[i.dataset.school] !== undefined,
    );
    await Promise.all(pending.map(saveSchoolField));
  }

  schoolInputs.forEach((input) => {
    input.addEventListener("input", () => {
      if (input.dataset.upper) {
        const start = input.selectionStart;
        const end = input.selectionEnd;
        input.value = input.value.toUpperCase();
        try {
          input.setSelectionRange(start, end);
        } catch (e) {
          /* not supported for this input type */
        }
      }
      syncSchoolInfo();
      clearTimeout(schoolTimers[input.dataset.school]);
      schoolTimers[input.dataset.school] = setTimeout(
        () => saveSchoolField(input),
        600,
      );
    });
    input.addEventListener("blur", () => {
      if (schoolTimers[input.dataset.school] !== undefined)
        saveSchoolField(input);
    });
  });

  async function loadSchoolInfo() {
    try {
      const h = await apiCall("GET", "/sbm/school-info");
      schoolInputs.forEach((input) => {
        const v = h[input.dataset.school] || "";
        input.value = input.dataset.upper ? v.toUpperCase() : v;
      });
      syncSchoolInfo();
    } catch (err) {
      /* leave the lines blank to be filled in by hand */
    }
  }

  // ---- School details + About drawer ----
  const drawerOverlay = el("sbm-drawer-overlay");
  const drawerEl = el("sbm-drawer");
  let drawerReturnFocus = null;

  function openDrawer() {
    drawerReturnFocus = document.activeElement;
    drawerOverlay.classList.add("visible");
    const first = schoolInputs[0];
    if (first) first.focus();
  }

  function closeDrawer() {
    if (!drawerOverlay.classList.contains("visible")) return;
    flushSchool(); // save anything still waiting on its typing delay
    drawerOverlay.classList.remove("visible");
    if (drawerReturnFocus && drawerReturnFocus.focus) drawerReturnFocus.focus();
  }

  el("sbm-school-open").addEventListener("click", () => openDrawer());
  el("sbm-drawer-close").addEventListener("click", closeDrawer);
  drawerOverlay.addEventListener("mousedown", (e) => {
    if (e.target === drawerOverlay) closeDrawer();
  });
  // Keep Tab inside the open drawer.
  drawerEl.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const f = Array.from(
      drawerEl.querySelectorAll(
        "input, button, [tabindex]:not([tabindex='-1'])",
      ),
    ).filter((x) => !x.disabled);
    if (!f.length) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  function schoolNoteHtml() {
    const row = (label, value) =>
      `<div class="sp-school-row"><span class="sp-school-label">${label}</span><span class="sp-school-value">${escapeHtml(value)}</span></div>`;
    return `<div class="sp-school">
      ${row("Name of School:", schoolInfo.school)}
      ${row("Name of School Head:", schoolInfo.head)}
      ${row("School Year:", schoolInfo.year)}
    </div>`;
  }

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
      ${schoolNoteHtml()}
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
    printBtn.addEventListener("click", async () => {
      // Make sure any remark still being typed is in the state first.
      Object.keys(saveTimers).forEach((k) => flushRemarks(Number(k)));
      await flushSchool(); // make sure the latest school details are saved
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
    loadSchoolInfo();
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
          movLink: r.movLink || "",
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
