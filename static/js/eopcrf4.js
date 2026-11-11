(function () {
  const tab = document.getElementById("eopcrf4-tab");
  if (!tab) return;

  // ------------------------------------------------------------------
  // Layout of the two tables. Part IV-A is all free text. Part IV-B's
  // first two columns (Strengths / Improvement Needs) are picks from the
  // top-rated / lowest-rated items in EOPCRF I (objectives) and EOPCRF II
  // (competency subsections); everything else is free text.
  // Part IV-A has 3 fixed rows; Part IV-B has 4. In Part IV-B, rows 1-2
  // pick from EOPCRF I objectives (all KRAs A-C pooled) and rows 3-4 pick
  // from EOPCRF II subsections (II-A and II-B pooled); each dropdown offers
  // the top 3 (Strengths) or lowest 3 (Improvement Needs) of its pool.
  // ------------------------------------------------------------------
  const PARTS = {
    A: {
      bodyId: "eopcrf4-table-body-a",
      positions: [1, 2, 3],
      columns: [
        {
          field: "gapAnalysis",
          type: "text",
          label: "Gap Analysis (SWOT)",
        },
        { field: "improvementArea", type: "text", label: "Improvement Area" },
        { field: "objective", type: "text", label: "General Objective" },
        {
          field: "intervention",
          type: "text",
          label: "Recommended Improvement Intervention",
        },
        { field: "timeline", type: "text", label: "Timeline" },
        { field: "resources", type: "text", label: "Resources Needed" },
      ],
    },
    B: {
      bodyId: "eopcrf4-table-body-b",
      positions: [1, 2, 3, 4],
      columns: [
        {
          field: "strengthRef",
          type: "ref",
          direction: "highest",
          label: "Strengths",
        },
        {
          field: "devNeedsRef",
          type: "ref",
          direction: "lowest",
          label: "Improvement Needs",
        },
        {
          field: "objective",
          type: "text",
          label: "Learning Objective (based on the developmental intervention)",
        },
        {
          field: "intervention",
          type: "text",
          label: "Recommended Developmental Intervention",
        },
        { field: "timeline", type: "text", label: "Timeline" },
        { field: "resources", type: "text", label: "Resources Needed" },
      ],
    },
  };
  // Which pooled source a Part IV-B row's picks come from.
  const REF_SOURCE_BY_POSITION = { 1: "o", 2: "o", 3: "c", 4: "c" };
  const REF_SOURCE_LABELS = {
    o: "EOPCRF I objectives (KRAs A–C)",
    c: "EOPCRF II subsections (II-A & II-B)",
  };
  const PART_TITLES = { A: "Part IV-A", B: "Part IV-B" };
  const TOP_N = 3;

  // Friendly names for EOPCRF II's section keys, and known subsection
  // titles. Any subsection key not listed here falls back to a humanized
  // version of the key itself (e.g. "self_management" -> "Self Management").
  const EOPCRF2_SECTION_LABELS = {
    leadership: "Leadership Competencies",
    cbc: "Core Behavioral Competencies",
  };
  const EOPCRF2_TITLE_OVERRIDES = {
    self_management: "Self Management",
    teamwork: "Teamwork",
    professionalism_ethics: "Professionalism and Ethics",
    service_orientation: "Service Orientation",
    result_focus: "Result Focus",
    innovation: "Innovation",
  };

  // ------------------------------------------------------------------
  // State
  // ------------------------------------------------------------------
  // rows: { "A1": { part, position, ...fields } }
  // edit: the row currently open in the edit modal -- { part, position, refs }
  //   (refs = in-progress dropdown picks; text fields are read from the form)
  // items: pooled, flattened candidate list rebuilt fresh on every load
  //   [{ id, main, source, average }] -- "top 5" is a live computation.
  const state = {
    year: null,
    rows: {},
    feedback: { A: "", B: "" },
    items: [],
    edit: null,
  };

  // ------------------------------------------------------------------  // ------------------------------------------------------------------
  // DOM refs
  // ------------------------------------------------------------------
  const el = (id) => document.getElementById(id);
  const listEl = el("eopcrf4-list");
  const editorEl = el("eopcrf4-editor");
  const progressCountEl = el("eopcrf4-progress-count");
  const segsEl = el("eopcrf4-segments");
  const nextBtn = el("eopcrf4-next-incomplete");
  const doneBadge = el("eopcrf4-done-badge");
  const saveStatusEl = el("eopcrf4-save-status");
  const workspaceEl = el("eopcrf4-workspace");
  const errorEl = el("eopcrf4-error-state");

  const resetBtn = el("eopcrf4-reset-btn");
  const resetConfirmOverlay = el("eopcrf4-reset-confirm-overlay");
  const resetConfirmCancelBtn = el("eopcrf4-reset-confirm-cancel");
  const resetConfirmConfirmBtn = el("eopcrf4-reset-confirm-confirm");

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------
  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : str;
    return div.innerHTML;
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
      throw new Error(
        "Network error — please check your connection and try again.",
      );
    }
    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      // no/invalid JSON body
    }
    if (!res.ok) {
      throw new Error(
        (data && data.error) || "Something went wrong. Please try again.",
      );
    }
    return data;
  }

  function average(values) {
    const rated = values.filter(
      (v) => v !== null && v !== undefined && !isNaN(v),
    );
    if (rated.length === 0) return null;
    return rated.reduce((sum, v) => sum + Number(v), 0) / rated.length;
  }

  function humanize(key) {
    return String(key)
      .split("_")
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }

  function rowKey(part, position) {
    return `${part}${position}`;
  }

  // ------------------------------------------------------------------
  // Ranking: rebuilt fresh from EOPCRF I / EOPCRF II data on every load.
  // Ref ids are prefixed so one pooled list can hold both kinds:
  //   "o:<objective id>"  -> EOPCRF I objective
  //   "c:<subsection key>" -> EOPCRF II subsection
  // ------------------------------------------------------------------
  // EOPCRF I keeps the objective number inside the objective's text, e.g.
  // "2.3. Manage school facilities ..." (Parts I-A and I-C: fixed,
  // pre-assigned numbers). Split it off so the number can sit in its own
  // column. When there is no such prefix (e.g. objectives added in Part I-B,
  // which numbers continuously as <KRA number>.<objective order in that KRA>),
  // the number is built the same way.
  const OBJ_PREFIX_RE = /^\s*(\d+(?:\.\d+)+)\.?\s+([\s\S]*)$/;
  function splitObjectiveText(text) {
    const m = String(text || "").match(OBJ_PREFIX_RE);
    return m
      ? { num: m[1], main: m[2].trim() }
      : { num: "", main: String(text || "").trim() };
  }

  function rankEopcrf1Objectives(data) {
    const items = [];
    const kraCountByPart = {}; // KRA number within its part: 1, 2, 3 ...
    (data.kras || []).forEach((kra) => {
      const partKey = String(kra.part || "");
      kraCountByPart[partKey] = (kraCountByPart[partKey] || 0) + 1;
      const kraNo = kraCountByPart[partKey];
      // "Leading Strategically (School Leadership and Administration)" ->
      // name + parenthetical group. An explicit kra.domain/group wins.
      const kraText = kra.text || "";
      const m = kraText.match(/^(.*?)\s*\((.*)\)\s*$/);
      const kraName = m ? m[1] : kraText;
      const kraGroup = kra.domain || kra.group || (m ? m[2] : "");
      (kra.objectives || []).forEach((obj, objIdx) => {
        if (obj.average === null || obj.average === undefined) return;
        const parts = splitObjectiveText(obj.text);
        items.push({
          id: `o:${obj.id}`,
          main: parts.main || "(untitled objective)",
          source: kraText,
          kra: kraName,
          group: kraGroup,
          num: parts.num || `${kraNo}.${objIdx + 1}`,
          average: obj.average,
        });
      });
    });
    return items;
  }

  function rankEopcrf2Subsections(data) {
    const ratings = data.ratings || {};
    const sections = data.sections || {};
    const items = [];
    Object.keys(ratings).forEach((key) => {
      const avg = average(Object.values(ratings[key] || {}));
      if (avg === null) return;
      items.push({
        id: `c:${key}`,
        main: EOPCRF2_TITLE_OVERRIDES[key] || humanize(key),
        source: EOPCRF2_SECTION_LABELS[sections[key]] || "EOPCRF II",
        kra: EOPCRF2_SECTION_LABELS[sections[key]] || "EOPCRF II",
        group: "",
        num: "",
        average: avg,
      });
    });
    return items;
  }

  // Candidate pool for a dropdown: items whose id prefix matches the
  // row's source ("o:" = EOPCRF I objective, "c:" = EOPCRF II subsection).
  function poolFor(position) {
    const source = REF_SOURCE_BY_POSITION[position];
    return state.items.filter((it) => it.id.startsWith(`${source}:`));
  }

  function topN(items, n, direction) {
    return items
      .slice()
      .sort((a, b) =>
        direction === "highest" ? b.average - a.average : a.average - b.average,
      )
      .slice(0, n);
  }
  // ------------------------------------------------------------------
  // Loading
  // ------------------------------------------------------------------
  async function loadAll() {
    try {
      const data = await apiCall("GET", "/irc/eopcrf4/data");
      state.year = data.year;
      state.rows = {};
      data.rows.forEach((r) => (state.rows[rowKey(r.part, r.position)] = r));
      state.feedback = Object.assign({ A: "", B: "" }, data.feedback || {});

      const [eopcrf1, eopcrf2] = await Promise.all([
        apiCall("GET", `/irc/eopcrf1/data?year=${state.year}`),
        apiCall("GET", `/irc/eopcrf2/data?year=${state.year}`),
      ]);
      state.items = rankEopcrf1Objectives(eopcrf1).concat(
        rankEopcrf2Subsections(eopcrf2),
      );

      render();
    } catch (err) {
      workspaceEl.style.display = "none";
      errorEl.style.display = "";
      errorEl.textContent = "Couldn\u2019t load Part IV: " + err.message;
    }
  }

  // Report-signatory footer (rendered by base.html below the page content,
  // so it doesn't exist yet when this script first runs -- hence the
  // DOMContentLoaded hook). Rater name/position are the same values as
  // "Name / Position of Rater" on EOPCRF I (report-header record);
  // Approving Authority name/position are the shared Approving Authority
  // record. Each input saves on blur with a partial body, so editing one
  // never clobbers the others.
  async function initSignatories() {
    const fields = [
      {
        id: "eopcrf4-rater-name",
        url: "/api/eopcrf1/report-header",
        key: "nameOfRater",
      },
      {
        id: "eopcrf4-rater-position",
        url: "/api/eopcrf1/report-header",
        key: "positionOfRater",
      },
      {
        id: "eopcrf4-authority-name",
        url: "/api/eopcrf1/approving-authority",
        key: "name",
      },
      {
        id: "eopcrf4-authority-position",
        url: "/api/eopcrf1/approving-authority",
        key: "position",
      },
    ];
    fields.forEach((f) => {
      f.input = document.getElementById(f.id);
      f.saved = "";
    });
    if (fields.some((f) => !f.input)) return;
    const el = (id) => fields.find((f) => f.id === id).input;

    const [header, authority] = await Promise.all([
      apiCall("GET", "/api/eopcrf1/report-header").catch(() => null),
      apiCall("GET", "/api/eopcrf1/approving-authority").catch(() => null),
    ]);
    if (header) {
      el("eopcrf4-rater-name").value = header.nameOfRater || "";
      el("eopcrf4-rater-position").value = header.positionOfRater || "";
    }
    if (authority) {
      el("eopcrf4-authority-name").value = authority.name || "";
      el("eopcrf4-authority-position").value = authority.position || "";
    }

    fields.forEach((f) => {
      f.saved = f.input.value.trim();
      f.input.addEventListener("blur", async () => {
        const value = f.input.value.trim();
        f.input.value = value;
        if (value === f.saved) return;
        try {
          await apiCall("POST", f.url, { [f.key]: value });
          f.saved = value;
        } catch (err) {
          alert(err.message);
        }
      });
      f.input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") f.input.blur();
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initSignatories);
  } else {
    initSignatories();
  }
  // ------------------------------------------------------------------
  // Row persistence
  // ------------------------------------------------------------------
  async function saveRow(part, position, patch) {
    const updated = await apiCall("POST", "/irc/eopcrf4/row", {
      year: state.year,
      part,
      position,
      ...patch,
    });
    state.rows[rowKey(part, position)] = updated;
    return updated;
  }
  // ------------------------------------------------------------------
  // Workbench: row list (nav-col) on the left, editor on the right.
  // Same API calls and saved fields as before; only the UI changed.
  // ------------------------------------------------------------------
  const ROW_ORDER = [];
  ["A", "B"].forEach((part) =>
    PARTS[part].positions.forEach((position) =>
      ROW_ORDER.push({ part, position }),
    ),
  );
  const PART_NAMES = {
    A: "Part IV-A · Office Improvement Plan",
    B: "Part IV-B · Individual Development Plan",
  };

  state.sel = null; // { kind: "row", part, position } | { kind: "feedback", part }
  state.confirmClear = false;
  state.fbDraft = { A: "", B: "" }; // live text of the Feedback boxes

  function rowStatus(part, position) {
    const row = state.rows[rowKey(part, position)] || {};
    const cols = PARTS[part].columns;
    const filled = cols.filter((c) => String(row[c.field] || "").trim()).length;
    if (filled === 0) return "empty";
    return filled === cols.length ? "done" : "partial";
  }

  function rowFilled(part, position) {
    const row = state.rows[rowKey(part, position)] || {};
    return PARTS[part].columns.filter((c) => String(row[c.field] || "").trim())
      .length;
  }

  function feedbackFilled(part) {
    return String(state.fbDraft[part] || "").trim().length > 0;
  }

  function isRowSel(part, position) {
    const s = state.sel;
    return (
      !!s && s.kind === "row" && s.part === part && s.position === position
    );
  }

  // Only failures are reported; successful saves are silent.
  function setStatus(message) {
    saveStatusEl.textContent = message ? "Couldn\u2019t save: " + message : "";
  }

  // ------------------------------------------------------------------
  // Autosave: every edit is saved a moment after the last keystroke
  // (ranked picks save at once). Saves run one after another so they
  // always land in order.
  // ------------------------------------------------------------------
  const SAVE_DELAY_MS = 350;
  let saveTimer = null;
  let saveChain = Promise.resolve();
  let saveDirty = false;

  function collectPatch() {
    const patch = { isLocked: true, ...state.edit.refs };
    editorEl.querySelectorAll("textarea[data-field]").forEach((ta) => {
      patch[ta.dataset.field] = ta.value;
    });
    return patch;
  }

  function flushSave() {
    clearTimeout(saveTimer);
    if (!saveDirty || !state.edit) return saveChain;
    const { part, position } = state.edit;
    const patch = collectPatch();
    saveDirty = false;
    saveChain = saveChain.then(async () => {
      try {
        await saveRow(part, position, patch);
        setStatus("");
        renderList();
      } catch (err) {
        setStatus(err.message);
      }
    });
    return saveChain;
  }

  function scheduleSave() {
    saveDirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, SAVE_DELAY_MS);
  }

  function cancelPendingSave() {
    clearTimeout(saveTimer);
    saveDirty = false;
    Object.keys(feedbackTimers).forEach((p) => clearTimeout(feedbackTimers[p]));
    return saveChain;
  }

  // Feedback boxes: saved when the box loses focus, or after a short pause.
  const feedbackTimers = {};

  async function saveFeedback(part) {
    clearTimeout(feedbackTimers[part]);
    const text = state.fbDraft[part];
    if (text === (state.feedback[part] || "")) return;
    try {
      const saved = await apiCall("POST", "/irc/eopcrf4/feedback", {
        year: state.year,
        part,
        text,
      });
      state.feedback[part] = saved.text || "";
      setStatus("");
    } catch (err) {
      setStatus(err.message);
    }
  }

  function flushFeedback() {
    return Promise.all(["A", "B"].map((p) => saveFeedback(p)));
  }

  // ------------------------------------------------------------------
  // List (nav-col)
  // ------------------------------------------------------------------
  function rowHtml({ kind, part, position }) {
    const isFb = kind === "feedback";
    const on = isFb
      ? !!state.sel && state.sel.kind === "feedback" && state.sel.part === part
      : isRowSel(part, position);
    const total = isFb ? 1 : PARTS[part].columns.length;
    const n = isFb ? (feedbackFilled(part) ? 1 : 0) : rowFilled(part, position);
    const isDone = n === total;
    const name = isFb ? "Feedback" : `Row ${position}`;
    const count = isFb
      ? feedbackFilled(part)
        ? "Written"
        : "Empty"
      : `${n}/${total}`;
    return `
      <div class="eopcrf4-row${on ? " is-active" : ""}${isDone ? " is-complete" : ""}">
        <button type="button" class="eopcrf4-row-main" data-kind="${kind}" data-part="${part}"${isFb ? "" : ` data-position="${position}"`} aria-current="${on}">
          <span class="eopcrf4-row-top">
            <span class="eopcrf4-row-text">
              <span class="eopcrf4-row-name">${name}</span>
            </span>
            <span class="eopcrf4-row-count">${isDone && !isFb ? '<i class="ti ti-circle-check-filled" aria-hidden="true"></i>' : ""}${count}</span>
          </span>
          <span class="eopcrf4-row-bar" aria-hidden="true"><span style="width:${(n / total) * 100}%"></span></span>
        </button>
      </div>`;
  }

  function renderList() {
    listEl.innerHTML = ["A", "B"]
      .map((part) => {
        const rows = PARTS[part].positions
          .map((position) => rowHtml({ kind: "row", part, position }))
          .join("");
        return `<div class="eopcrf4-list-group">${PART_NAMES[part]}</div>${rows}${rowHtml({ kind: "feedback", part })}`;
      })
      .join("");
    renderProgress();
  }

  // Overall progress panel: one segment per row. Feedback boxes aren't counted.
  function renderProgress() {
    const total = ROW_ORDER.length;
    const done = ROW_ORDER.filter(
      (r) => rowStatus(r.part, r.position) === "done",
    ).length;
    const complete = done === total;
    progressCountEl.classList.toggle("is-complete", complete);
    progressCountEl.innerHTML = `<strong>${done} of ${total}</strong><span>complete</span>`;
    segsEl.setAttribute("aria-valuemax", String(total));
    segsEl.setAttribute("aria-valuenow", String(done));
    segsEl.innerHTML = ROW_ORDER.map((r) => {
      const filled = rowFilled(r.part, r.position);
      const cols = PARTS[r.part].columns.length;
      return `
        <button type="button" class="eopcrf4-seg${isRowSel(r.part, r.position) ? " is-active" : ""}${filled === cols ? " is-complete" : ""}"
                data-part="${r.part}" data-position="${r.position}" title="${PART_TITLES[r.part]} Row ${r.position}: ${filled} of ${cols} filled">
          <span class="eopcrf4-seg-bar"><span style="width:${(filled / cols) * 100}%"></span></span>
          <span class="eopcrf4-seg-label">${r.part}${r.position}</span>
        </button>`;
    }).join("");
    nextBtn.hidden = complete;
    doneBadge.hidden = !complete;
  }

  // ------------------------------------------------------------------
  // Editor
  // ------------------------------------------------------------------
  // Ranked picks are shown as a card per pick: a title ("Choose one
  // strength"), a one-line source note, a column header, then one selectable
  // row per candidate (radio, number, text, key result area, score).
  // Rows from EOPCRF I objectives have a No. column; EOPCRF II competency
  // rows do not.
  function renderRefPicker(column, currentRef, position) {
    const { field, direction } = column;
    const isObj = REF_SOURCE_BY_POSITION[position] === "o";
    const tone = direction === "highest" ? "strength" : "need";
    const candidates = topN(poolFor(position), TOP_N, direction);

    // Keep the saved pick visible even if it has since fallen out of the
    // ranking, or is gone entirely.
    let extra = null;
    if (currentRef && !candidates.some((c) => c.id === currentRef)) {
      extra = state.items.find((c) => c.id === currentRef) || {
        id: currentRef,
        main: "(previously selected — no longer available)",
        kra: "",
        group: "",
        num: "",
        average: null,
        unavailable: true,
      };
    }
    const options = (extra ? [{ ...extra, isExtra: true }] : []).concat(
      candidates,
    );

    const title = `Choose one ${tone === "strength" ? "strength" : "improvement need"}`;
    const n = candidates.length;
    const noun = isObj
      ? n > 1
        ? "objectives"
        : "objective"
      : n > 1
        ? "competencies"
        : "competency";
    const sub =
      n === 0
        ? ""
        : `From your ${n > 1 ? n + " " : ""}${direction === "highest" ? "highest" : "lowest"}-rated ${noun}`;
    const head = `<div class="eopcrf4-pick-h">
        <div class="eopcrf4-pick-title" id="eopcrf4-fld-${field}-label">${title}</div>
        ${sub ? `<div class="eopcrf4-pick-sub">${sub}</div>` : ""}
      </div>`;
    const cls = `eopcrf4-pick eopcrf4-pick--${isObj ? "obj" : "cmp"} eopcrf4-pick-${tone}`;

    if (options.length === 0) {
      return `<div class="${cls}" data-field="${field}">${head}<p class="eopcrf4-pick-empty">No ratings yet. Rate items in EOPCRF I and II first.</p></div>`;
    }

    const cols = isObj
      ? `<span></span><span>No.</span><span>Objective</span><span>Key Result Area</span><span class="eopcrf4-col-score">Score</span>`
      : `<span></span><span>Competency</span><span>Category</span><span class="eopcrf4-col-score">Score</span>`;

    const rowsHtml = options
      .map((c) => {
        const selected = c.id === currentRef;
        const note = c.isExtra
          ? `<span class="eopcrf4-opt-note">Outside your current ${TOP_N}</span>`
          : "";
        const kra = c.kra
          ? `<span class="eopcrf4-opt-kra-name">${escapeHtml(c.kra)}</span>${c.group ? `<span class="eopcrf4-opt-kra-group">(${escapeHtml(c.group)})</span>` : ""}`
          : "";
        const score = c.average == null ? "–" : Number(c.average).toFixed(2);
        return `<button type="button" role="radio" aria-checked="${selected}" class="eopcrf4-opt" data-value="${escapeHtml(c.id)}">
          <span class="eopcrf4-radio" aria-hidden="true"></span>
          ${isObj ? `<span class="eopcrf4-no">${escapeHtml(c.num || "–")}</span>` : ""}
          <span class="eopcrf4-opt-main">${escapeHtml(c.main)}${note}</span>
          <span class="eopcrf4-opt-kra">${kra}</span>
          <span class="eopcrf4-opt-score">${score}</span>
        </button>`;
      })
      .join("");

    return `<div class="${cls}" data-field="${field}">
      ${head}
      <div class="eopcrf4-pick-cols" aria-hidden="true">${cols}</div>
      <div class="eopcrf4-pick-rows" role="radiogroup" aria-labelledby="eopcrf4-fld-${field}-label">${rowsHtml}</div>
    </div>`;
  }

  const GROUPS = {
    A: [
      {
        title: "Where we are",
        fields: ["gapAnalysis", "improvementArea", "objective"],
        wide: ["gapAnalysis"],
      },
      {
        title: "The plan",
        fields: ["intervention", "timeline", "resources"],
        wide: ["intervention"],
      },
    ],
    B: [
      {
        title: "Evidence from your ratings",
        fields: ["strengthRef", "devNeedsRef"],
        wide: ["strengthRef", "devNeedsRef"],
      },
      {
        title: "Growth plan",
        fields: ["objective", "intervention", "timeline", "resources"],
        wide: ["objective", "intervention"],
      },
    ],
  };

  function fieldHtml(column, row, wide) {
    const id = `eopcrf4-fld-${column.field}`;
    const m = String(column.label || column.field).match(/^(.*?)\s*\((.*)\)$/);
    const label = escapeHtml(m ? m[1] : column.label || column.field);
    const note = m
      ? `<span class="eopcrf4-fl-hint">${escapeHtml(m[2])}</span>`
      : "";
    const cls = `eopcrf4-fld${wide ? " eopcrf4-span-2" : ""}`;
    if (column.type === "ref") {
      return `
        <div class="${cls}">
          ${renderRefPicker(column, state.edit.refs[column.field], row.position)}
        </div>`;
    }
    const rows =
      column.field === "timeline" || column.field === "resources" ? 3 : 4;
    return `
      <label class="${cls}">
        <span class="eopcrf4-fl">${label}${note}</span>
        <textarea rows="${rows}" data-field="${column.field}" style="min-height:calc(${rows} * 1.45em + 18px)">${escapeHtml(row[column.field] || "")}</textarea>
      </label>`;
  }

  function rowBodyHtml(part, row) {
    return `
      <div class="eopcrf4-ed-body">
        ${GROUPS[part]
          .map((g) => {
            const cells = g.fields
              .map((f) =>
                fieldHtml(
                  PARTS[part].columns.find((c) => c.field === f),
                  row,
                  g.wide.includes(f),
                ),
              )
              .join("");
            return `
          <section class="eopcrf4-stage" aria-label="${g.title}">
            <div class="eopcrf4-stage-grid">${cells}</div>
          </section>`;
          })
          .join("")}
      </div>`;
  }

  function feedbackBodyHtml(part) {
    return `
      <div class="eopcrf4-ed-body">
        <section class="eopcrf4-stage" aria-label="Feedback">
          <div class="eopcrf4-stage-grid">
            <label class="eopcrf4-fld eopcrf4-span-2 eopcrf4-feedback-field">
              <span class="eopcrf4-fl">Feedback</span>
              <textarea rows="6" data-feedback="${part}" style="min-height:calc(6 * 1.45em + 18px)">${escapeHtml(state.fbDraft[part] || "")}</textarea>
            </label>
          </div>
        </section>
      </div>`;
  }

  // Banner at the top of the editor: part (small), row name (large), Clear.
  function headHtml() {
    const s = state.sel;
    const isFb = s.kind === "feedback";
    const cat = PART_NAMES[s.part];
    const name = isFb ? "Feedback" : `Row ${s.position}`;
    let actions = "";
    if (!isFb) {
      actions = state.confirmClear
        ? `<span class="eopcrf4-ed-ask">Clear this row?</span>
           <button type="button" class="eopcrf4-ed-del eopcrf4-ed-del--confirm" data-act="clear-yes">Clear</button>
           <button type="button" class="eopcrf4-ed-del" data-act="clear-no">Keep</button>`
        : `<button type="button" class="eopcrf4-ed-del" data-act="clear"><i class="ti ti-eraser" aria-hidden="true"></i> Clear row</button>`;
    }
    return `
      <div class="eopcrf4-ed-head" id="eopcrf4-ed-head">
        <span class="eopcrf4-ed-title">
          <span class="eopcrf4-ed-cat">${cat}</span>
          <span class="eopcrf4-ed-name">${name}</span>
        </span>
        <span class="eopcrf4-ed-actions">${actions}</span>
      </div>`;
  }

  // Swaps only the banner (keeps unsaved typing in the fields below).
  function refreshHead() {
    const head = el("eopcrf4-ed-head");
    if (head && state.sel) head.outerHTML = headHtml();
  }

  // Textareas are not user-resizable: each box starts at its default height
  // and grows only when the text needs more room. Side-by-side boxes share
  // the taller height so their edges line up.
  function autosize(ta) {
    const fld = ta.closest(".eopcrf4-fld");
    const grid = ta.closest(".eopcrf4-stage-grid");
    const pair =
      fld && !fld.classList.contains("eopcrf4-span-2") && grid
        ? Array.from(
            grid.querySelectorAll(".eopcrf4-fld:not(.eopcrf4-span-2) textarea"),
          )
        : [ta];
    const h = Math.max(
      ...pair.map((b) => {
        b.style.height = "auto";
        return b.scrollHeight + 2; // +2 = the 1px borders
      }),
    );
    pair.forEach((b) => (b.style.height = h + "px"));
  }
  window.addEventListener("resize", () =>
    editorEl.querySelectorAll("textarea").forEach(autosize),
  );

  function renderEditor() {
    const s = state.sel;
    if (!s) {
      editorEl.innerHTML = "";
      return;
    }
    if (s.kind === "feedback") {
      state.edit = null;
      editorEl.innerHTML = `${headHtml()}${feedbackBodyHtml(s.part)}`;
    } else {
      const row = state.rows[rowKey(s.part, s.position)] || {
        part: s.part,
        position: s.position,
      };
      state.edit = { part: s.part, position: s.position, refs: {} };
      PARTS[s.part].columns.forEach((col) => {
        if (col.type === "ref")
          state.edit.refs[col.field] = row[col.field] || "";
      });
      editorEl.innerHTML = `${headHtml()}${rowBodyHtml(s.part, row)}`;
    }
    saveDirty = false;
    editorEl.querySelectorAll("textarea").forEach(autosize);
  }

  async function select(next) {
    await Promise.all([flushSave(), flushFeedback()]);
    state.sel = next;
    state.confirmClear = false;
    renderList();
    renderEditor();
    const target =
      next.kind === "feedback"
        ? listEl.querySelector(
            `.eopcrf4-row-main[data-kind="feedback"][data-part="${next.part}"]`,
          )
        : listEl.querySelector(
            `.eopcrf4-row-main[data-kind="row"][data-part="${next.part}"][data-position="${next.position}"]`,
          );
    if (target && target.scrollIntoView)
      target.scrollIntoView({ block: "nearest" });
  }

  // Go to the next row that isn't complete yet (wrapping around).
  function goNextIncomplete() {
    const n = ROW_ORDER.length;
    const i =
      state.sel && state.sel.kind === "row"
        ? ROW_ORDER.findIndex(
            (r) =>
              r.part === state.sel.part && r.position === state.sel.position,
          )
        : -1;
    for (let k = 1; k <= n; k++) {
      const r = ROW_ORDER[(i + k + n) % n];
      if (rowStatus(r.part, r.position) !== "done") {
        select({ kind: "row", part: r.part, position: r.position });
        return;
      }
    }
  }

  function render() {
    state.fbDraft = Object.assign({ A: "", B: "" }, state.feedback);
    if (!state.sel) {
      const first =
        ROW_ORDER.find((r) => rowStatus(r.part, r.position) !== "done") ||
        ROW_ORDER[0];
      state.sel = { kind: "row", part: first.part, position: first.position };
    }
    renderList();
    renderEditor();
    errorEl.style.display = "none";
    workspaceEl.style.display = "";
  }

  // ------------------------------------------------------------------
  // Events
  // ------------------------------------------------------------------
  listEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".eopcrf4-row-main");
    if (!btn) return;
    if (btn.dataset.kind === "feedback") {
      select({ kind: "feedback", part: btn.dataset.part });
    } else {
      select({
        kind: "row",
        part: btn.dataset.part,
        position: Number(btn.dataset.position),
      });
    }
  });

  segsEl.addEventListener("click", (e) => {
    const seg = e.target.closest(".eopcrf4-seg[data-part]");
    if (seg)
      select({
        kind: "row",
        part: seg.dataset.part,
        position: Number(seg.dataset.position),
      });
  });

  nextBtn.addEventListener("click", goNextIncomplete);

  editorEl.addEventListener("click", (e) => {
    // Banner actions: clear the row (two steps, like AIP's delete).
    const act = e.target.closest("[data-act]");
    if (act && state.edit) {
      const a = act.dataset.act;
      if (a === "clear") {
        state.confirmClear = true;
        refreshHead();
      } else if (a === "clear-no") {
        state.confirmClear = false;
        refreshHead();
      } else if (a === "clear-yes") {
        state.confirmClear = false;
        Object.keys(state.edit.refs).forEach((f) => (state.edit.refs[f] = ""));
        const { part, position } = state.edit;
        const refs = state.edit.refs;
        editorEl.innerHTML = `${headHtml()}${rowBodyHtml(part, { part, position })}`;
        state.edit.refs = refs;
        editorEl.querySelectorAll("textarea").forEach(autosize);
        saveDirty = true;
        flushSave();
      }
      return;
    }

    // Picking a ranked option (click again to unselect).
    const picker = e.target.closest(".eopcrf4-pick");
    if (!picker || !state.edit) return;
    const opt = e.target.closest(".eopcrf4-opt");
    if (!opt) return;
    const field = picker.dataset.field;
    const current = state.edit.refs[field];
    const next = opt.dataset.value === current ? "" : opt.dataset.value;
    state.edit.refs[field] = next;
    const column = PARTS[state.edit.part].columns.find(
      (c) => c.field === field,
    );
    picker.outerHTML = renderRefPicker(column, next, state.edit.position);
    saveDirty = true;
    flushSave();
    const again = editorEl.querySelector(
      `.eopcrf4-pick[data-field="${field}"] .eopcrf4-opt[data-value="${CSS.escape(opt.dataset.value)}"]`,
    );
    if (again) again.focus();
  });

  editorEl.addEventListener("input", (e) => {
    const ta = e.target.closest("textarea");
    if (!ta) return;
    autosize(ta);
    if (ta.dataset.feedback) {
      const part = ta.dataset.feedback;
      state.fbDraft[part] = ta.value;
      renderList(); // keeps the Feedback status live as you type
      clearTimeout(feedbackTimers[part]);
      feedbackTimers[part] = setTimeout(() => saveFeedback(part), 1000);
    } else if (ta.dataset.field) {
      scheduleSave();
    }
  });

  editorEl.addEventListener("focusout", (e) => {
    const ta = e.target.closest && e.target.closest("textarea");
    if (!ta) return;
    if (ta.dataset.feedback) saveFeedback(ta.dataset.feedback);
    else flushSave();
  });

  // ------------------------------------------------------------------
  // Reset-page confirmation modal
  //
  // Single scope, no options -- everything on this page is the seven fixed
  // plan rows plus the two Feedback boxes, so there's no "values only" vs
  // "everything" split.
  // ------------------------------------------------------------------
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
    await cancelPendingSave();
    state.sel = null;
    try {
      await apiCall("DELETE", `/irc/eopcrf4/reset?year=${state.year}`);
      await loadAll();
    } catch (err) {
      alert(err.message || "Could not reset the data. Please try again.");
    } finally {
      resetConfirmConfirmBtn.disabled = false;
      closeResetConfirm();
    }
  });
  // ------------------------------------------------------------------
  // Print / Save as PDF
  //
  // Builds a print-only copy of Part IV (Part IV-A, Part IV-B, Feedback
  // boxes, signatories) laid out like the OPCRF sheet's page 4, then calls
  // window.print(). Styling is in eopcrf4_print.css (long bond, landscape).
  // The root is moved to <body> so the print stylesheet can hide the rest
  // of the page.
  // ------------------------------------------------------------------
  const printRoot = document.getElementById("eopcrf4-print-root");
  const printBtn = document.getElementById("eopcrf4-print-btn");
  const printCache = { header: {}, authority: { name: "" } };
  if (printRoot) document.body.appendChild(printRoot);

  const pText = (v) => escapeHtml(v == null ? "" : String(v));

  // Same column widths for both tables so they line up, as on the sheet.
  const PRINT_COLGROUP =
    '<colgroup><col style="width:17%"><col style="width:16%"><col style="width:18%"><col style="width:17%"><col style="width:16%"><col style="width:16%"></colgroup>';

  const PRINT_HEADS = {
    A: [
      'Gap Analysis<br><span class="r-sub">(SWOT)</span>',
      "Improvement Area",
      "General Objective",
      "Recommended Improvement Intervention",
      "Timeline",
      "Resources Needed",
    ],
    B: [
      "Strengths",
      "Improvement Needs",
      'Learning Objective<br><span class="r-sub">(based on the developmental intervention)</span>',
      "Recommended Developmental Intervention",
      "Timeline",
      "Resources Needed",
    ],
  };

  function printRefCell(row, column) {
    const ref = row[column.field];
    if (!ref) return "<td></td>";
    const match = state.items.find((c) => c.id === ref);
    if (!match) return "<td></td>";
    const meta = `${match.source ? match.source + " · " : ""}${match.average.toFixed(2)}`;
    return `<td><div class="r-ref-main">${pText(match.num ? match.num + ". " + match.main : match.main)}</div><div class="r-ref-meta">${pText(meta)}</div></td>`;
  }

  function printPart(part) {
    const def = PARTS[part];
    const heads = PRINT_HEADS[part].map((t) => `<th>${t}</th>`).join("");
    const rows = def.positions
      .map((position) => {
        const row = state.rows[rowKey(part, position)] || {};
        const cells = def.columns
          .map((col) =>
            col.type === "ref"
              ? printRefCell(row, col)
              : `<td>${pText(row[col.field])}</td>`,
          )
          .join("");
        return `<tr>${cells}</tr>`;
      })
      .join("");
    // Feedback reads the live textarea so unsaved typing still prints.
    const feedback = state.fbDraft[part] || "";
    return `<div class="r-part">
      <h3>${PART_TITLES[part]}: ${part === "A" ? "Office Improvement Plan" : "Individual Development Plan"}</h3>
      <table class="r-table r-table-${part.toLowerCase()}">
        ${PRINT_COLGROUP}
        <thead>
          <tr class="r-band"><th></th><th></th><th colspan="2">Action Plan</th><th></th><th></th></tr>
          <tr class="r-cols">${heads}</tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="r-feedback"><span class="r-feedback-label">Feedback:</span>${pText(feedback)}</div>
    </div>`;
  }

  function buildPrintHtml() {
    const h = printCache.header || {};
    const a = printCache.authority || {};
    const up = (v) => (v == null ? "" : String(v).toUpperCase());
    const sign = (name, role) =>
      `<div class="r-sign"><div class="r-sign-name">${pText(up(name))}</div><div class="r-sign-role">${role}</div></div>`;
    return `
      <div class="r-page-label">DepEd OPCRF (ver.Feb2025), page 4 of 4</div>
      <div class="r-title">Part IV: Improvement and Development Plans</div>
      ${printPart("A")}
      ${printPart("B")}
      <div class="r-signs">
        ${sign(h.nameOfEmployee, "RATEE")}
        ${sign(h.nameOfRater, "RATER")}
        ${sign(a.name, "APPROVING AUTHORITY")}
      </div>`;
  }

  function refreshPrintRoot() {
    if (printRoot) printRoot.innerHTML = buildPrintHtml();
  }

  // Ratee / Rater / Approving Authority names are the ones kept on EOPCRF I.
  async function loadPrintExtras() {
    const [h, a] = await Promise.allSettled([
      apiCall("GET", "/api/eopcrf1/report-header"),
      apiCall("GET", "/api/eopcrf1/approving-authority"),
    ]);
    if (h.status === "fulfilled") printCache.header = h.value;
    if (a.status === "fulfilled") printCache.authority = a.value;
  }

  if (printBtn && printRoot) {
    printBtn.addEventListener("click", async () => {
      printBtn.disabled = true;
      try {
        await Promise.all([flushSave(), flushFeedback()]);
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

  // ------------------------------------------------------------------
  // Initial load
  // ------------------------------------------------------------------
  loadAll();
})();
