(function () {
  const workspaceEl = document.getElementById("eopcrf1-workspace");
  if (!workspaceEl) return;

  const navEl = document.getElementById("eopcrf1-nav");
  const detailEl = document.getElementById("eopcrf1-detail");
  const emptyStateEl = document.getElementById("eopcrf1-empty-state");
  const emptyStateTextEl = document.getElementById("eopcrf1-empty-state-text");
  const partTabsEl = document.getElementById("eopcrf1-part-tabs");
  const emptyAddKraBtn = document.getElementById("eopcrf1-empty-add-kra");

  // ================= Reset button + confirmation modal =================
  const resetBtn = document.getElementById("eopcrf1-reset-btn");
  const resetConfirmOverlay = document.getElementById(
    "eopcrf1-reset-confirm-overlay",
  );
  const resetConfirmCancelBtn = document.getElementById(
    "eopcrf1-reset-confirm-cancel",
  );
  const resetConfirmConfirmBtn = document.getElementById(
    "eopcrf1-reset-confirm-confirm",
  );
  const resetScopeRadios = document.querySelectorAll(
    'input[name="eopcrf1-reset-scope"]',
  );
  const resetConfirmWarning = document.getElementById(
    "eopcrf1-reset-confirm-warning",
  );

  // ================= Modal elements =================
  const modal = document.getElementById("eopcrf1-entry-modal");
  const modalTitle = document.getElementById("eopcrf1-entry-modal-title");
  const modalHint = document.getElementById("eopcrf1-entry-modal-hint");
  const modalClose = document.getElementById("eopcrf1EntryModalClose");
  const modalCancel = document.getElementById("eopcrf1EntryModalCancel");
  const modalOverlay = document.getElementById("eopcrf1EntryModalOverlay");
  const modalSubmit = document.getElementById("eopcrf1EntryModalSubmit");
  const fieldPrimaryWrap = document.getElementById("eopcrf1-field-primary");
  const fieldPrimaryLabel = document.getElementById(
    "eopcrf1-field-primary-label",
  );
  const primaryInput = document.getElementById("eopcrf1-entry-text");
  const fieldUrlWrap = document.getElementById("eopcrf1-field-url");
  const urlInput = document.getElementById("eopcrf1-entry-url");
  const fieldRateWrap = document.getElementById("eopcrf1-field-rate");
  const rateSelect = document.getElementById("eopcrf1-entry-rate");
  const fieldWeightWrap = document.getElementById("eopcrf1-field-weight");
  const fieldWeightLabel = document.getElementById(
    "eopcrf1-field-weight-label",
  );
  const weightInput = document.getElementById("eopcrf1-entry-weight");
  const extraFieldsEl = document.getElementById("eopcrf1-extra-fields");

  // ================= Icons =================
  const svg = (inner, cls) =>
    `<svg${cls ? ` class="${cls}"` : ""} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  const ICON_EDIT = svg(
    '<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>',
  );
  const ICON_TRASH = svg(
    '<polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path>',
  );
  const ICON_PLUS = svg(
    '<path d="M12 5v14M5 12h14"></path>',
    "eopcrf1-inline-icon",
  );
  const ICON_LINK = svg(
    '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>',
  );
  const ICON_LOCK = svg(
    '<rect x="3" y="11" width="18" height="10" rx="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path>',
    "eopcrf1-inline-icon",
  );

  // Progress ring shown on each objective in the sidebar. The arc length is
  // done/total, so the ring fills as the objective is completed:
  //   none    -> empty track
  //   partial -> arc proportional to what is filled in
  //   done    -> solid ring with a check mark
  const RING_R = 8;
  const RING_C = 2 * Math.PI * RING_R;
  function progressRing(prog) {
    const track = `<circle class="eopcrf1-ring-track" cx="12" cy="12" r="${RING_R}"></circle>`;
    if (prog.state === "done") {
      return `<svg class="eopcrf1-ring" viewBox="0 0 24 24" aria-hidden="true"><circle class="eopcrf1-ring-fill" cx="12" cy="12" r="10.5"></circle><path class="eopcrf1-ring-check" d="M7.8 12.4l3 3 5.4-6"></path></svg>`;
    }
    const frac = prog.total ? prog.done / prog.total : 0;
    const arc =
      prog.state === "partial"
        ? `<circle class="eopcrf1-ring-arc" cx="12" cy="12" r="${RING_R}" stroke-dasharray="${(RING_C * frac).toFixed(2)} ${RING_C.toFixed(2)}" transform="rotate(-90 12 12)"></circle>`
        : "";
    return `<svg class="eopcrf1-ring" viewBox="0 0 24 24" aria-hidden="true">${track}${arc}</svg>`;
  }
  const PROGRESS_LABELS = {
    none: "Not started",
    partial: "In progress",
    done: "Complete",
  };

  const INDICATOR_CATEGORIES = [
    { key: "quality", label: "Quality" },
    { key: "efficiency", label: "Efficiency" },
    { key: "timeliness", label: "Timeliness" },
  ];
  const LEVELS = [
    { n: 5, name: "Outstanding" },
    { n: 4, name: "Very satisfactory" },
    { n: 3, name: "Satisfactory" },
    { n: 2, name: "Unsatisfactory" },
    { n: 1, name: "Poor" },
  ];
  const levelName = (n) =>
    (LEVELS.find((l) => l.n === Number(n)) || {}).name || "";

  const PARTS = [
    {
      key: "a",
      label: "Part I-A",
      full: "Commitment to Organizational Outcomes",
    },
    {
      key: "b",
      label: "Part I-B",
      full: "Innovating and Intervening Accomplishments",
    },
    { key: "c", label: "Part I-C", full: "Organizational Effectiveness" },
  ];
  const PART_EXPECTED_TOTAL = { a: 60, b: 20, c: 15 };
  let activePart = "a";

  // ================= State =================
  // `state.kras` mirrors GET /irc/eopcrf1/data. `sel` is the only piece of
  // view state: which KRA / objective is open in the detail panel.
  const state = { kras: [], year: null };
  const sel = { kraId: null, objId: null };
  const id = (v) => String(v);

  // ================= API helper =================
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

  // ================= Helpers =================
  function letterLabel(index) {
    let n = index;
    let label = "";
    do {
      label = String.fromCharCode(65 + (n % 26)) + label;
      n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return label;
  }

  // 1-based position of a KRA within its own part (I-A, I-B or I-C)
  function kraNumber(kra) {
    const idx = state.kras
      .filter((k) => k.part === kra.part)
      .findIndex((k) => id(k.id) === id(kra.id));
    return idx === -1 ? 1 : idx + 1;
  }

  const hasVal = (v) => v !== null && v !== undefined && v !== "" && !isNaN(v);
  const fmtWeight = (w) =>
    hasVal(w) ? Math.round(Number(w) * 100) / 100 + "%" : "—";
  const fmt3 = (n) => Number(n).toFixed(3);

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : str;
    return div.innerHTML;
  }

  function sumWeights(list) {
    return list.reduce((sum, item) => {
      const w = parseFloat(item.weight);
      return sum + (isNaN(w) ? 0 : w);
    }, 0);
  }

  // Objective weights should add up to their KRA's weight.
  function objectiveWeightMismatch(kra) {
    const totalObj = sumWeights(kra.objectives);
    const kraW = parseFloat(kra.weight);
    const mismatch =
      kra.objectives.length > 0 &&
      !isNaN(kraW) &&
      Math.abs(totalObj - kraW) >= 0.005;
    return { mismatch, totalObj, kraW };
  }

  function computeAverage(obj) {
    let sum = 0;
    let count = 0;
    INDICATOR_CATEGORIES.forEach((c) => {
      const v = obj.ratings[c.key];
      if (hasVal(v)) {
        sum += Number(v);
        count++;
      }
    });
    return count === 0 ? null : sum / count;
  }

  function computeScore(obj) {
    const avg = computeAverage(obj);
    const w = parseFloat(obj.weight);
    if (avg === null || isNaN(w)) return null;
    return avg * (w / 100);
  }

  // "1.2. Develop and ..." -> { code: "1.2", title: "Develop and ..." }
  function splitObjectiveText(text, fallbackCode) {
    const m = /^\s*(\d+\.\d+)\.?\s+([\s\S]*)$/.exec(text || "");
    return m
      ? { code: m[1], title: m[2] }
      : { code: fallbackCode, title: text || "" };
  }

  // ================= Lookups =================
  const findKra = (kraId) => state.kras.find((k) => id(k.id) === id(kraId));
  function findObjective(kraId, objId) {
    const kra = findKra(kraId);
    return kra
      ? kra.objectives.find((o) => id(o.id) === id(objId)) || null
      : null;
  }

  function upsertObjective(updated) {
    const kra = findKra(updated.kraId);
    if (!kra) return;
    const idx = kra.objectives.findIndex((o) => id(o.id) === id(updated.id));
    if (idx === -1) kra.objectives.push(updated);
    else kra.objectives[idx] = updated;
  }

  function upsertIndicator(kraId, objId, category, item) {
    const obj = findObjective(kraId, objId);
    if (!obj) return;
    const idx = obj[category].findIndex((i) => id(i.id) === id(item.id));
    if (idx === -1) obj[category].push(item);
    else obj[category][idx] = item;
  }

  // ================= Totals =================
  function partTotals(partKey) {
    const kras = state.kras.filter((k) => k.part === partKey);
    let scoreSum = 0;
    let hasAny = false;
    kras.forEach((k) =>
      k.objectives.forEach((o) => {
        const s = computeScore(o);
        if (s !== null) {
          scoreSum += s;
          hasAny = true;
        }
      }),
    );
    return { weight: sumWeights(kras), score: hasAny ? scoreSum : null };
  }

  // ================= Render: tabs =================
  function renderPartTabs() {
    partTabsEl.innerHTML = PARTS.map((p) => {
      const t = partTotals(p.key);
      const expected = PART_EXPECTED_TOTAL[p.key];
      const weightOk = Math.abs(t.weight - expected) < 0.005;
      const weightTip = weightOk
        ? `Part weight (target ${expected}%)`
        : `Part weight is ${fmtWeight(t.weight)}. It should total ${expected}%`;
      return `
        <button type="button" class="eopcrf1-part-tab${p.key === activePart ? " is-active" : ""}" data-part="${p.key}" role="tab" aria-selected="${p.key === activePart}">
          <span class="eopcrf1-part-tab-label">${p.label}</span>
          <span class="eopcrf1-part-tab-name">${escapeHtml(p.full)}</span>
          <span class="eopcrf1-part-tab-stats">
            <span class="eopcrf1-part-tab-stat" title="${escapeHtml(weightTip)}">
              <span class="eopcrf1-part-tab-k">Weight</span>
              <span class="eopcrf1-part-tab-v${weightOk ? "" : " is-warn"}">${fmtWeight(t.weight)}</span>
            </span>
            <span class="eopcrf1-part-tab-stat" title="Total score for this part">
              <span class="eopcrf1-part-tab-k">Score</span>
              <span class="eopcrf1-part-tab-v${t.score === null ? " is-empty" : ""}">${t.score === null ? "—" : fmt3(t.score)}</span>
            </span>
          </span>
        </button>`;
    }).join("");
  }

  partTabsEl.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-part]");
    if (!btn || btn.dataset.part === activePart) return;
    activePart = btn.dataset.part;
    render();
  });

  // ================= Render: selection =================
  function ensureSelection(visibleKras) {
    const kra = visibleKras.find((k) => id(k.id) === id(sel.kraId));
    if (kra) {
      if (
        sel.objId === null ||
        kra.objectives.some((o) => id(o.id) === id(sel.objId))
      )
        return;
    }
    const withObjs = visibleKras.find((k) => k.objectives.length > 0);
    if (withObjs) {
      sel.kraId = withObjs.id;
      sel.objId = withObjs.objectives[0].id;
    } else if (visibleKras.length) {
      sel.kraId = visibleKras[0].id;
      sel.objId = null;
    } else {
      sel.kraId = null;
      sel.objId = null;
    }
  }

  // ================= Objective progress =================
  // Tracks the three things the user has to fill in on every objective:
  //   1. Timeline
  //   2. Performance measures and rating scale: for each of Quality /
  //      Efficiency / Timeliness a rating is chosen, and (on KRAs the user
  //      builds, i.e. not locked) all five level descriptors are written
  //   3. Actual accomplishments
  // Returns { state: "none" | "partial" | "done", done, total, missing[] }.
  function objectiveProgress(kra, obj) {
    const filled = (v) => typeof v === "string" && v.trim() !== "";
    const checks = [{ label: "Timeline", ok: filled(obj.timeline) }];
    INDICATOR_CATEGORIES.forEach((c) => {
      checks.push({
        label: `${c.label} rating`,
        ok: hasVal(obj.ratings && obj.ratings[c.key]),
      });
      if (!kra.locked) {
        const items = obj[c.key] || [];
        checks.push({
          label: `${c.label} descriptors`,
          ok: LEVELS.every((l) =>
            items.some((i) => i.rate === l.n && filled(i.label)),
          ),
        });
      }
    });
    checks.push({
      label: "Actual accomplishments",
      ok: filled(obj.actualResults),
    });
    const done = checks.filter((c) => c.ok).length;
    const total = checks.length;
    return {
      state: done === 0 ? "none" : done === total ? "done" : "partial",
      done,
      total,
      missing: checks.filter((c) => !c.ok).map((c) => c.label),
    };
  }

  // ================= Render: sidebar =================
  // Sticky strip at the top of the nav (Part I-B only): the Add KRA button plus
  // a live meter of the KRA weight total against the 20% cap.
  function renderNavToolbar() {
    if (activePart !== "b") return "";
    const expected = PART_EXPECTED_TOTAL.b;
    const total = partTotals("b").weight;
    const diff = Math.round((expected - total) * 100) / 100;
    // Weight met (20%): no indicator at all, just the Add KRA button.
    let stateCls = "";
    let msg = "";
    if (diff > 0.005) {
      stateCls = "is-warn";
      msg = `KRA weights total ${fmtWeight(total)}, not ${expected}%. Allocate ${fmtWeight(diff)} more.`;
    } else if (diff < -0.005) {
      stateCls = "is-over";
      msg = `KRA weights total ${fmtWeight(total)}, which is ${fmtWeight(-diff)} over the ${expected}% target. Reduce a KRA's weight.`;
    }
    const pct = Math.max(0, Math.min(100, (total / expected) * 100));
    const meter = stateCls
      ? `<div class="eopcrf1-nav-total ${stateCls}" role="status">
          <div class="eopcrf1-nav-total-head">
            <span>KRA weight</span>
            <strong>${fmtWeight(total)} / ${expected}%</strong>
          </div>
          <div class="eopcrf1-nav-total-bar" aria-hidden="true"><span style="width:${pct}%"></span></div>
          <p class="eopcrf1-nav-total-msg">${escapeHtml(msg)}</p>
        </div>`
      : "";
    return `
      <div class="eopcrf1-nav-toolbar">
        <button type="button" class="eopcrf1-add-btn eopcrf1-nav-add" data-action="add-kra">${ICON_PLUS}Add KRA</button>
        ${meter}
      </div>`;
  }

  function renderNav(visibleKras) {
    const groups = visibleKras
      .map((kra) => {
        const isSelKra = id(kra.id) === id(sel.kraId);
        const actions = kra.locked
          ? ""
          : `<button type="button" class="eopcrf1-icon-btn" data-action="add-objective" data-kra-id="${kra.id}" title="Add objective">${ICON_PLUS}</button>
             <button type="button" class="eopcrf1-icon-btn" data-action="edit-kra" data-kra-id="${kra.id}" title="Edit KRA">${ICON_EDIT}</button>
             <button type="button" class="eopcrf1-icon-btn eopcrf1-icon-btn--danger" data-action="delete-kra" data-kra-id="${kra.id}" title="Delete KRA">${ICON_TRASH}</button>`;
        const mm = objectiveWeightMismatch(kra);
        const navWarn = mm.mismatch
          ? `<p class="eopcrf1-warn eopcrf1-nav-warn" role="alert">Objective weights total ${fmtWeight(mm.totalObj)}, but this KRA is ${fmtWeight(mm.kraW)}. They should match.</p>`
          : "";
        const items = kra.objectives
          .map((obj, i) => {
            const { code, title } = splitObjectiveText(
              obj.text,
              `${kraNumber(kra)}.${i + 1}`,
            );
            const isSel = isSelKra && id(obj.id) === id(sel.objId);
            const prog = objectiveProgress(kra, obj);
            const progTip =
              prog.state === "done"
                ? "Complete"
                : `${PROGRESS_LABELS[prog.state]} (${prog.done}/${prog.total}). Still needed: ${prog.missing.join(", ")}`;
            return `
              <button type="button" class="eopcrf1-nav-item${isSel ? " is-selected" : ""}" data-action="select-obj" data-kra-id="${kra.id}" data-obj-id="${obj.id}" title="${escapeHtml(title || "Untitled objective")}"${isSel ? ' aria-current="true"' : ""}>
                <span class="eopcrf1-nav-main">
                  <span class="eopcrf1-nav-progress eopcrf1-nav-progress--${prog.state}" title="${escapeHtml(progTip)}" role="img" aria-label="${escapeHtml(PROGRESS_LABELS[prog.state] + " (" + prog.done + " of " + prog.total + ")")}">${progressRing(prog)}</span>
                  <span class="eopcrf1-nav-code">Objective ${escapeHtml(code)}</span>
                </span>
                <span class="eopcrf1-nav-weight" title="Objective weight">${fmtWeight(obj.weight)}</span>
              </button>`;
          })
          .join("");
        return `
          <div class="eopcrf1-nav-group">
            <div class="eopcrf1-nav-group-head${isSelKra && sel.objId === null ? " is-selected" : ""}">
              <span class="eopcrf1-nav-group-label">KRA ${kraNumber(kra)}</span>
              <div class="eopcrf1-nav-group-row">
                <button type="button" class="eopcrf1-nav-group-title" data-action="select-kra" data-kra-id="${kra.id}">${kra.text ? escapeHtml(kra.text) : "Untitled KRA"}</button>
                <span class="eopcrf1-nav-group-weight" title="KRA weight">${fmtWeight(kra.weight)}</span>
              </div>
              ${actions ? `<div class="eopcrf1-nav-group-actions">${actions}</div>` : ""}
            </div>
            ${navWarn}
            ${items}
          </div>`;
      })
      .join("");
    navEl.innerHTML = renderNavToolbar() + groups;
  }

  // ================= Render: detail panel =================
  function field(label, valueHtml, extraCls) {
    return `<div class="eopcrf1-fact${extraCls ? " " + extraCls : ""}"><span class="eopcrf1-label">${label}</span><div class="eopcrf1-fact-value">${valueHtml}</div></div>`;
  }
  const textOrDash = (v) =>
    v ? escapeHtml(v) : '<span class="eopcrf1-muted">—</span>';

  function renderKraBlock(kra) {
    const isC = kra.part === "c";
    const editBtn = kra.locked
      ? ""
      : `<button type="button" class="eopcrf1-icon-btn" data-action="edit-kra" data-kra-id="${kra.id}" title="Edit KRA">${ICON_EDIT}</button>`;
    const align =
      isC || kra.part === "b"
        ? ""
        : `<div class="eopcrf1-align">
           ${field("GAA programs / subprograms", textOrDash(kra.gaaProgram))}
           ${field("BEDP pillars", textOrDash(kra.bedpPillars))}
           ${field("Current administration agenda", textOrDash(kra.adminAgenda))}
         </div>`;
    return `
      <section class="eopcrf1-kra-block">
        <div class="eopcrf1-kra-block-head">
          <div>
            <span class="eopcrf1-label">${isC ? "Area" : "KRA"} ${kraNumber(kra)}</span>
            <h3>${kra.text ? escapeHtml(kra.text) : "Untitled KRA"}</h3>
          </div>
          <div class="eopcrf1-kra-block-side">
            <span class="eopcrf1-weight-chip">${fmtWeight(kra.weight)}</span>
            ${editBtn}
          </div>
        </div>
        ${align}
      </section>`;
  }

  function renderLevelRow(obj, cat, level, selectedRate, locked) {
    const item = obj[cat.key].find((i) => i.rate === level.n);
    const isSel = selectedRate === level.n;
    let actions = "";
    if (!locked) {
      actions = item
        ? `<span class="eopcrf1-level-actions">
             <button type="button" class="eopcrf1-icon-btn" data-action="edit-rubric" data-category="${cat.key}" data-item-id="${item.id}" title="Edit descriptor">${ICON_EDIT}</button>
             <button type="button" class="eopcrf1-icon-btn eopcrf1-icon-btn--danger" data-action="delete-rubric" data-category="${cat.key}" data-item-id="${item.id}" title="Remove descriptor">${ICON_TRASH}</button>
           </span>`
        : `<span class="eopcrf1-level-actions"><button type="button" class="eopcrf1-btn eopcrf1-btn--ghost eopcrf1-btn--sm" data-action="add-rubric" data-category="${cat.key}" data-level="${level.n}">${ICON_PLUS}Add descriptor</button></span>`;
    }
    return `
      <div class="eopcrf1-level${isSel ? " is-selected" : ""}" role="radio" aria-checked="${isSel}" tabindex="0" data-action="pick-level" data-category="${cat.key}" data-level="${level.n}" title="${isSel ? "Click to clear this rating" : `Rate ${cat.label.toLowerCase()} ${level.n}`}">
        <span class="eopcrf1-level-num">${level.n}</span>
        <span class="eopcrf1-level-name">${level.name}</span>
        <span class="eopcrf1-level-text">${item ? escapeHtml(item.label) : '<span class="eopcrf1-muted">No descriptor for this level</span>'}</span>
        ${actions}
      </div>`;
  }

  function renderCategory(obj, cat, locked) {
    const raw = obj.ratings[cat.key];
    const selectedRate = hasVal(raw) ? Number(raw) : null;
    return `
      <section class="eopcrf1-cat">
        <div class="eopcrf1-cat-head">
          <h4>${cat.label}</h4>
          <span class="eopcrf1-cat-rating${selectedRate === null ? " is-empty" : ""}">${selectedRate === null ? "Not rated" : `${selectedRate} · ${levelName(selectedRate)}`}</span>
        </div>
        <div class="eopcrf1-levels${selectedRate === null ? "" : " has-selection"}" role="radiogroup" aria-label="${cat.label} rating">
          ${LEVELS.map((l) => renderLevelRow(obj, cat, l, selectedRate, locked)).join("")}
        </div>
      </section>`;
  }

  function renderMovLink(obj) {
    if (!obj.mov) {
      return `<button type="button" class="eopcrf1-btn eopcrf1-btn--ghost eopcrf1-btn--sm" data-action="edit-mov">${ICON_PLUS}Add link</button>`;
    }
    return `
      <div class="eopcrf1-mov-row">
        <a class="eopcrf1-mov-link" href="${escapeHtml(obj.mov)}" target="_blank" rel="noopener noreferrer">${ICON_LINK}<span>${escapeHtml(obj.mov)}</span></a>
        <button type="button" class="eopcrf1-icon-btn" data-action="edit-mov" title="Edit link">${ICON_EDIT}</button>
        <button type="button" class="eopcrf1-icon-btn eopcrf1-icon-btn--danger" data-action="delete-mov" title="Remove link">${ICON_TRASH}</button>
      </div>`;
  }

  function renderObjective(kra, obj) {
    const locked = !!kra.locked;
    const objIndex = kra.objectives.findIndex((o) => id(o.id) === id(obj.id));
    const { code, title } = splitObjectiveText(
      obj.text,
      `${kraNumber(kra)}.${objIndex + 1}`,
    );
    const avg = computeAverage(obj);
    const score = computeScore(obj);
    const chip = (label, key) => {
      const v = obj.ratings[key];
      return `<div class="eopcrf1-result"><span class="eopcrf1-label">${label}</span><span class="eopcrf1-result-value">${hasVal(v) ? v : "—"}</span></div>`;
    };
    const objActions = locked
      ? ""
      : `<button type="button" class="eopcrf1-icon-btn" data-action="edit-objective" title="Edit objective">${ICON_EDIT}</button>
         <button type="button" class="eopcrf1-icon-btn eopcrf1-icon-btn--danger" data-action="delete-objective" title="Delete objective">${ICON_TRASH}</button>`;

    return `
      <section class="eopcrf1-obj" data-kra-id="${kra.id}" data-obj-id="${obj.id}">
        <div class="eopcrf1-obj-head">
          <div>
            <span class="eopcrf1-label">Objective ${escapeHtml(code)}</span>
            <h3>${title ? escapeHtml(title) : "Untitled objective"}</h3>
          </div>
          <div class="eopcrf1-obj-actions">${objActions}</div>
        </div>

        <div class="eopcrf1-group eopcrf1-group--plan">
          <h4 class="eopcrf1-group-title"><i class="ti ti-calendar-event" aria-hidden="true"></i>Planning</h4>
          <div class="eopcrf1-group-body">
          <div class="eopcrf1-facts">
            ${field("Timeline", `<span>${textOrDash(obj.timeline)}</span><button type="button" class="eopcrf1-icon-btn" data-action="edit-timeline" title="Edit timeline">${ICON_EDIT}</button>`, "eopcrf1-fact--inline")}
            ${field("Weight allocation", escapeHtml(fmtWeight(obj.weight)))}
            ${field("Target value", textOrDash(obj.targetValue))}
            ${field("Target description", textOrDash(obj.targetDescription))}
          </div>
          </div>
        </div>

        <div class="eopcrf1-group eopcrf1-group--perf">
          <h4 class="eopcrf1-group-title"><i class="ti ti-list-check" aria-hidden="true"></i>Performance measures and rating scale</h4>
          <div class="eopcrf1-group-body">
          ${INDICATOR_CATEGORIES.map((c) => renderCategory(obj, c, locked)).join("")}
          </div>
        </div>

        <div class="eopcrf1-group eopcrf1-group--eval">
          <h4 class="eopcrf1-group-title"><i class="ti ti-clipboard-check" aria-hidden="true"></i>Evaluation</h4>
          <div class="eopcrf1-group-body">
          <div class="eopcrf1-eval">
            <div class="eopcrf1-fact">
              <span class="eopcrf1-label">Means of verification</span>
              <div class="eopcrf1-box${obj.movRequired ? "" : " is-empty"}">${obj.movRequired ? escapeHtml(obj.movRequired) : "No MOVs listed for this objective."}</div>
              <div class="eopcrf1-mov-wrap">${renderMovLink(obj)}</div>
            </div>
            <div class="eopcrf1-fact">
              <span class="eopcrf1-label eopcrf1-label--row">Actual accomplishments<button type="button" class="eopcrf1-icon-btn" data-action="edit-actual" title="Edit actual accomplishments">${ICON_EDIT}</button></span>
              <div class="eopcrf1-box${obj.actualResults ? "" : " is-empty"}">${obj.actualResults ? escapeHtml(obj.actualResults) : "No accomplishments recorded yet."}</div>
            </div>
          </div>
          <div class="eopcrf1-results">
            ${chip("Quality", "quality")}${chip("Efficiency", "efficiency")}${chip("Timeliness", "timeliness")}
            <div class="eopcrf1-result eopcrf1-result--total"><span class="eopcrf1-label">Average (QET)</span><span class="eopcrf1-result-value">${avg === null ? "—" : fmt3(avg)}</span></div>
            <div class="eopcrf1-result eopcrf1-result--total"><span class="eopcrf1-label">Weighted average</span><span class="eopcrf1-result-value">${score === null ? "—" : fmt3(score)}</span></div>
          </div>
          </div>
        </div>
      </section>`;
  }

  function renderDetail(visibleKras) {
    const kra = visibleKras.find((k) => id(k.id) === id(sel.kraId));
    if (!kra) {
      detailEl.innerHTML = "";
      return;
    }
    const obj = sel.objId !== null ? findObjective(kra.id, sel.objId) : null;
    let body = renderKraBlock(kra);
    if (obj) {
      body += renderObjective(kra, obj);
    } else if (!kra.locked) {
      body += `<div class="eopcrf1-empty-inline"><p>This KRA has no objectives yet.</p><button type="button" class="eopcrf1-btn eopcrf1-btn--primary" data-action="add-objective" data-kra-id="${kra.id}">${ICON_PLUS}Add objective</button></div>`;
    }
    detailEl.innerHTML = body;
  }

  // ================= Render: all =================
  function render() {
    renderPartTabs();

    const visibleKras = state.kras.filter((k) => k.part === activePart);
    const isEmpty = visibleKras.length === 0;
    emptyStateEl.style.display = isEmpty ? "block" : "none";
    emptyAddKraBtn.style.display =
      isEmpty && activePart === "b" ? "inline-flex" : "none";
    workspaceEl.style.display = isEmpty ? "none" : "";
    if (isEmpty) {
      emptyStateTextEl.innerHTML =
        activePart === "b"
          ? "No KRAs yet. Click <strong>Add KRA</strong> to start planning."
          : "Nothing here yet. This part's fixed structure is created the first time data loads for this rating year.";
      navEl.innerHTML = "";
      detailEl.innerHTML = "";
      return;
    }

    ensureSelection(visibleKras);
    renderNav(visibleKras);
    renderDetail(visibleKras);
  }

  // ================= Modal control =================
  let modalCtx = null; // { mode, kraId, objId, category, itemId, level }
  let extraDefs = [];

  function setExtraFields(defs) {
    extraDefs = defs;
    extraFieldsEl.innerHTML = defs
      .map((d) => {
        const idAttr = `eopcrf1-x-${d.key}`;
        const control =
          d.type === "textarea"
            ? `<textarea id="${idAttr}" class="eopcrf1-input" rows="2" placeholder="${escapeHtml(d.placeholder || "")}"></textarea>`
            : `<input type="text" id="${idAttr}" class="eopcrf1-input" placeholder="${escapeHtml(d.placeholder || "")}" />`;
        return `<div class="eopcrf1-field-group"><label class="eopcrf1-label" for="${idAttr}">${escapeHtml(d.label)}</label>${control}</div>`;
      })
      .join("");
    defs.forEach((d) => {
      document.getElementById(`eopcrf1-x-${d.key}`).value = d.value || "";
    });
  }
  const extraVal = (key) =>
    document.getElementById(`eopcrf1-x-${key}`).value.trim();

  function resetModalFields() {
    fieldPrimaryWrap.style.display = "none";
    fieldUrlWrap.style.display = "none";
    fieldRateWrap.style.display = "none";
    fieldWeightWrap.style.display = "none";
    primaryInput.value = "";
    urlInput.value = "";
    weightInput.value = "";
    rateSelect.innerHTML = "";
    setExtraFields([]);
  }

  function populateRateOptions(existingRates, currentRate, preferred) {
    rateSelect.innerHTML = "";
    for (let r = 5; r >= 1; r--) {
      if (existingRates.includes(r) && r !== currentRate) continue;
      const opt = document.createElement("option");
      opt.value = String(r);
      opt.textContent = `${r} · ${levelName(r)}`;
      rateSelect.appendChild(opt);
    }
    const want = currentRate || preferred;
    rateSelect.value = want ? String(want) : rateSelect.options[0]?.value || "";
  }

  function openModal(ctx) {
    modalCtx = ctx;
    resetModalFields();
    modalHint.textContent = "";

    if (ctx.mode === "add-kra" || ctx.mode === "edit-kra") {
      const isEdit = ctx.mode === "edit-kra";
      const kra = isEdit ? findKra(ctx.kraId) : null;
      modalTitle.textContent = isEdit ? "Edit KRA" : "Add KRA";
      fieldPrimaryWrap.style.display = "block";
      fieldPrimaryLabel.textContent = "KRA description";
      fieldWeightWrap.style.display = "block";
      fieldWeightLabel.textContent = "Weight (%). Part I-B should total 20%";
      if (isEdit && kra) {
        primaryInput.value = kra.text || "";
        weightInput.value = kra.weight ?? "";
      }
    } else if (ctx.mode === "add-objective" || ctx.mode === "edit-objective") {
      const isEdit = ctx.mode === "edit-objective";
      const obj = isEdit ? findObjective(ctx.kraId, ctx.objId) : null;
      modalTitle.textContent = isEdit ? "Edit objective" : "Add objective";
      fieldPrimaryWrap.style.display = "block";
      fieldPrimaryLabel.textContent = "Objective description";
      primaryInput.placeholder = "Describe the objective...";
      fieldWeightWrap.style.display = "block";
      fieldWeightLabel.textContent = "Weight (%)";
      if (isEdit && obj) {
        primaryInput.value = obj.text || "";
        weightInput.value = obj.weight ?? "";
      }
      setExtraFields([
        {
          key: "targetValue",
          label: "Target value (optional)",
          type: "text",
          placeholder: "e.g. 100%",
          value: obj ? obj.targetValue : "",
        },
        {
          key: "targetDescription",
          label: "Target description (optional)",
          type: "textarea",
          placeholder: "Expected outcome, output or service",
          value: obj ? obj.targetDescription : "",
        },
        {
          key: "movRequired",
          label: "Means of verification (optional)",
          type: "textarea",
          placeholder: "Documents that prove this objective",
          value: obj ? obj.movRequired : "",
        },
      ]);
    } else if (ctx.mode === "add-rubric" || ctx.mode === "edit-rubric") {
      const isEdit = ctx.mode === "edit-rubric";
      const obj = findObjective(ctx.kraId, ctx.objId);
      const catLabel = INDICATOR_CATEGORIES.find(
        (c) => c.key === ctx.category,
      ).label;
      const existing = obj[ctx.category];
      const item = isEdit
        ? existing.find((i) => id(i.id) === id(ctx.itemId))
        : null;
      modalTitle.textContent =
        (isEdit ? "Edit " : "Add ") + catLabel.toLowerCase() + " descriptor";
      modalHint.textContent =
        "Choose the rating level, then describe what earns it.";
      fieldRateWrap.style.display = "block";
      populateRateOptions(
        existing.map((i) => i.rate),
        item ? item.rate : null,
        ctx.level,
      );
      fieldPrimaryWrap.style.display = "block";
      fieldPrimaryLabel.textContent = "Descriptor";
      primaryInput.placeholder =
        "What must be accomplished for this rating level...";
      if (isEdit && item) primaryInput.value = item.label || "";
    } else if (ctx.mode === "edit-mov") {
      const obj = findObjective(ctx.kraId, ctx.objId);
      modalTitle.textContent = obj.mov ? "Edit MOV link" : "Add MOV link";
      fieldUrlWrap.style.display = "block";
      urlInput.value = obj.mov || "";
    } else if (ctx.mode === "edit-actual") {
      const obj = findObjective(ctx.kraId, ctx.objId);
      modalTitle.textContent = "Edit actual accomplishments";
      fieldPrimaryWrap.style.display = "block";
      fieldPrimaryLabel.textContent = "Actual accomplishments";
      primaryInput.placeholder = "Describe what was actually accomplished...";
      primaryInput.value = obj.actualResults || "";
    } else if (ctx.mode === "edit-timeline") {
      const obj = findObjective(ctx.kraId, ctx.objId);
      modalTitle.textContent = "Edit timeline";
      fieldPrimaryWrap.style.display = "block";
      fieldPrimaryLabel.textContent = "Timeline";
      primaryInput.placeholder = "e.g. SY 2025-2026";
      primaryInput.value = obj.timeline || "";
    }

    modal.style.display = "flex";
    (fieldPrimaryWrap.style.display !== "none"
      ? primaryInput
      : urlInput
    ).focus();
  }

  function closeModal() {
    modal.style.display = "none";
    modalCtx = null;
  }

  modalClose.addEventListener("click", closeModal);
  modalCancel.addEventListener("click", closeModal);
  modalOverlay.addEventListener("click", closeModal);
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (modal.style.display !== "none") closeModal();
    else if (resetConfirmOverlay.classList.contains("visible"))
      closeResetConfirm();
  });
  modal
    .querySelector(".eopcrf1-modal-content")
    .addEventListener("click", (e) => e.stopPropagation());

  function parseWeightInput() {
    const raw = weightInput.value.trim();
    if (raw === "") return { ok: true, weight: null };
    const weight = parseFloat(raw);
    if (isNaN(weight) || weight < 0 || weight > 100) {
      alert("Weight must be a number between 0 and 100.");
      return { ok: false };
    }
    return { ok: true, weight };
  }

  modalSubmit.addEventListener("click", async () => {
    if (!modalCtx) return;
    const mode = modalCtx.mode;
    modalSubmit.disabled = true;
    try {
      if (mode === "add-kra" || mode === "edit-kra") {
        const text = primaryInput.value.trim();
        if (!text) return alert("Please describe the KRA.");
        const w = parseWeightInput();
        if (!w.ok) return;
        const body = {
          text,
          weight: w.weight,
        };
        if (mode === "edit-kra") body.id = modalCtx.kraId;
        else body.year = state.year;
        const kra = await apiCall("POST", "/irc/eopcrf1/kra", body);
        if (mode === "add-kra") {
          state.kras.push(kra);
          sel.kraId = kra.id;
          sel.objId = null;
        } else {
          const idx = state.kras.findIndex((k) => id(k.id) === id(kra.id));
          if (idx !== -1) state.kras[idx] = kra;
        }
      } else if (mode === "add-objective" || mode === "edit-objective") {
        const text = primaryInput.value.trim();
        if (!text) return alert("Please describe the objective.");
        const w = parseWeightInput();
        if (!w.ok) return;
        const body = {
          text,
          weight: w.weight,
          targetValue: extraVal("targetValue"),
          targetDescription: extraVal("targetDescription"),
          movRequired: extraVal("movRequired"),
        };
        if (mode === "edit-objective") body.id = modalCtx.objId;
        else body.kraId = modalCtx.kraId;
        const obj = await apiCall("POST", "/irc/eopcrf1/objective", body);
        upsertObjective(obj);
        if (mode === "add-objective") {
          sel.kraId = obj.kraId;
          sel.objId = obj.id;
        }
      } else if (mode === "add-rubric" || mode === "edit-rubric") {
        const label = primaryInput.value.trim();
        const rate = parseInt(rateSelect.value, 10);
        if (!label) return alert("Please describe this rating level.");
        if (!rate) return alert("Please select a rating level.");
        const body = {
          objectiveId: modalCtx.objId,
          category: modalCtx.category,
          rate,
          label,
        };
        if (mode === "edit-rubric") body.id = modalCtx.itemId;
        const item = await apiCall("POST", "/irc/eopcrf1/indicator", body);
        upsertIndicator(
          modalCtx.kraId,
          modalCtx.objId,
          modalCtx.category,
          item,
        );
      } else if (mode === "edit-mov") {
        const url = urlInput.value.trim();
        if (!url) return alert("Please paste a link.");
        upsertObjective(
          await apiCall(
            "POST",
            `/irc/eopcrf1/objective/${modalCtx.objId}/mov`,
            { url },
          ),
        );
      } else if (mode === "edit-actual") {
        upsertObjective(
          await apiCall(
            "POST",
            `/irc/eopcrf1/objective/${modalCtx.objId}/actual-results`,
            { text: primaryInput.value.trim() },
          ),
        );
      } else if (mode === "edit-timeline") {
        upsertObjective(
          await apiCall(
            "POST",
            `/irc/eopcrf1/objective/${modalCtx.objId}/timeline`,
            { text: primaryInput.value.trim() },
          ),
        );
      }
      closeModal();
      render();
    } catch (err) {
      alert(err.message);
    } finally {
      modalSubmit.disabled = false;
    }
  });

  emptyAddKraBtn.addEventListener("click", () =>
    openModal({ mode: "add-kra" }),
  );

  // ================= Reset =================
  const RESET_WARNINGS = {
    ratings_mov:
      "This clears every rating and MOV link but keeps your KRAs, objectives and weights. This cannot be undone.",
    all: "This removes every Part I-B KRA, objective and indicator, along with everything typed into them, and clears all ratings and MOV links. This cannot be undone.",
  };
  const getSelectedResetScope = () => {
    const checked = document.querySelector(
      'input[name="eopcrf1-reset-scope"]:checked',
    );
    return checked ? checked.value : "ratings_mov";
  };
  function updateResetWarning() {
    const scope = getSelectedResetScope();
    resetConfirmWarning.textContent =
      RESET_WARNINGS[scope] || RESET_WARNINGS.ratings_mov;
    resetConfirmWarning.classList.toggle(
      "eopcrf1-reset-warning--danger",
      scope === "all",
    );
  }
  resetScopeRadios.forEach((r) =>
    r.addEventListener("change", updateResetWarning),
  );

  function openResetConfirm() {
    document.getElementById("eopcrf1-reset-scope-ratings").checked = true;
    updateResetWarning();
    resetConfirmOverlay.classList.add("visible");
  }
  function closeResetConfirm() {
    resetConfirmOverlay.classList.remove("visible");
  }

  function clearAllRatingsAndMovInPlace() {
    state.kras.forEach((kra) =>
      kra.objectives.forEach((obj) => {
        obj.ratings = { quality: null, efficiency: null, timeliness: null };
        obj.mov = null;
      }),
    );
    render();
  }
  function removePartBKrasInPlace() {
    // Part I-A / I-C are fixed and survive "reset entire form" server-side,
    // so only Part I-B KRAs leave the list here (their ratings/MOV clear too).
    state.kras = state.kras.filter((k) => k.locked);
    clearAllRatingsAndMovInPlace();
  }

  resetBtn.addEventListener("click", openResetConfirm);
  resetConfirmCancelBtn.addEventListener("click", closeResetConfirm);
  resetConfirmOverlay.addEventListener("click", (e) => {
    if (e.target === resetConfirmOverlay) closeResetConfirm();
  });
  resetConfirmConfirmBtn.addEventListener("click", async () => {
    const scope = getSelectedResetScope();
    resetConfirmConfirmBtn.disabled = true;
    try {
      const data = await apiCall(
        "DELETE",
        `/irc/eopcrf1/reset?scope=${scope}&year=${state.year}`,
      );
      if (data && data.scope === "all") removePartBKrasInPlace();
      else clearAllRatingsAndMovInPlace();
    } catch (err) {
      alert(err.message || "Could not reset the data. Please try again.");
    } finally {
      resetConfirmConfirmBtn.disabled = false;
      closeResetConfirm();
    }
  });

  // ================= Delegated clicks (sidebar + detail) =================
  async function setRating(objId, category, rating, kraId) {
    try {
      const updated = await apiCall(
        "POST",
        `/irc/eopcrf1/objective/${objId}/rating`,
        { category, rating },
      );
      upsertObjective(updated);
    } catch (err) {
      alert(err.message);
    }
    render();
  }

  workspaceEl.addEventListener("click", async (e) => {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    if (e.target.closest("a")) return; // let MOV links open

    const action = el.dataset.action;
    const kraId = el.dataset.kraId || (sel.kraId !== null ? sel.kraId : null);
    const objId = el.dataset.objId || (sel.objId !== null ? sel.objId : null);

    switch (action) {
      case "select-obj":
        sel.kraId = kraId;
        sel.objId = objId;
        render();
        // In the stacked (narrow) layout the detail sits below the list, so
        // bring it into view. On desktop it is already beside the list.
        if (
          window.matchMedia &&
          window.matchMedia("(max-width: 900px)").matches &&
          detailEl.scrollIntoView
        ) {
          detailEl.scrollIntoView({ block: "start" });
        }
        break;
      case "select-kra": {
        const kra = findKra(kraId);
        sel.kraId = kraId;
        sel.objId = kra && kra.objectives.length ? kra.objectives[0].id : null;
        render();
        break;
      }
      case "add-kra":
        openModal({ mode: "add-kra" });
        break;
      case "edit-kra":
        openModal({ mode: "edit-kra", kraId });
        break;
      case "delete-kra": {
        const kra = findKra(kraId);
        if (
          !confirm(
            `Delete "${kra.text || "this KRA"}" and all of its objectives? This cannot be undone.`,
          )
        )
          return;
        try {
          await apiCall("DELETE", `/irc/eopcrf1/kra/${kraId}`);
          state.kras = state.kras.filter((k) => id(k.id) !== id(kraId));
          if (id(sel.kraId) === id(kraId)) {
            sel.kraId = null;
            sel.objId = null;
          }
          render();
        } catch (err) {
          alert(err.message);
        }
        break;
      }
      case "add-objective":
        openModal({ mode: "add-objective", kraId });
        break;
      case "edit-objective":
        openModal({ mode: "edit-objective", kraId, objId });
        break;
      case "delete-objective": {
        const kra = findKra(kraId);
        const obj = findObjective(kraId, objId);
        if (
          !confirm(
            `Delete objective "${obj.text || "this objective"}"? This cannot be undone.`,
          )
        )
          return;
        try {
          await apiCall("DELETE", `/irc/eopcrf1/objective/${objId}`);
          kra.objectives = kra.objectives.filter((o) => id(o.id) !== id(objId));
          sel.objId = null;
          render();
        } catch (err) {
          alert(err.message);
        }
        break;
      }
      case "add-rubric":
        openModal({
          mode: "add-rubric",
          kraId,
          objId,
          category: el.dataset.category,
          level: parseInt(el.dataset.level, 10),
        });
        break;
      case "edit-rubric":
        openModal({
          mode: "edit-rubric",
          kraId,
          objId,
          category: el.dataset.category,
          itemId: el.dataset.itemId,
        });
        break;
      case "delete-rubric": {
        const obj = findObjective(kraId, objId);
        const category = el.dataset.category;
        if (!confirm("Remove this descriptor? This cannot be undone.")) return;
        try {
          await apiCall(
            "DELETE",
            `/irc/eopcrf1/indicator/${el.dataset.itemId}`,
          );
          // The selected rating is left as-is: it may have been set by hand
          // and the server never derives it from the descriptor list.
          obj[category] = obj[category].filter(
            (i) => id(i.id) !== id(el.dataset.itemId),
          );
          render();
        } catch (err) {
          alert(err.message);
        }
        break;
      }
      case "edit-mov":
        openModal({ mode: "edit-mov", kraId, objId });
        break;
      case "delete-mov":
        try {
          upsertObjective(
            await apiCall("POST", `/irc/eopcrf1/objective/${objId}/mov`, {
              url: "",
            }),
          );
          render();
        } catch (err) {
          alert(err.message);
        }
        break;
      case "edit-actual":
        openModal({ mode: "edit-actual", kraId, objId });
        break;
      case "edit-timeline":
        openModal({ mode: "edit-timeline", kraId, objId });
        break;
      case "pick-level": {
        const obj = findObjective(kraId, objId);
        if (!obj) return;
        const category = el.dataset.category;
        const level = parseInt(el.dataset.level, 10);
        const current = hasVal(obj.ratings[category])
          ? Number(obj.ratings[category])
          : null;
        await setRating(
          objId,
          category,
          current === level ? null : level,
          kraId,
        );
        break;
      }
    }
  });

  // Keyboard: Enter / Space on a focused rating row acts like a click.
  workspaceEl.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const row = e.target.closest('.eopcrf1-level[data-action="pick-level"]');
    if (!row || e.target !== row) return;
    e.preventDefault();
    row.click();
  });

  // ================= Form details (report header) =================
  const detailsSumEl = document.getElementById("eopcrf1-details-sum");
  const headerInputs = document.querySelectorAll("[data-header]");

  function updateDetailsSummary(h) {
    const bits = [h.nameOfEmployee, h.ratingPeriod].filter(Boolean);
    detailsSumEl.textContent = bits.length
      ? bits.join(" · ")
      : "Not filled in yet";
  }

  async function loadHeader() {
    try {
      const h = await apiCall("GET", "/api/eopcrf1/report-header");
      headerInputs.forEach((inp) => {
        inp.value = h[inp.dataset.header] || "";
      });
      updateDetailsSummary(h);
    } catch (err) {
      /* the form still works without its header block */
    }
  }

  headerInputs.forEach((inp) => {
    inp.addEventListener("change", async () => {
      try {
        const h = await apiCall("POST", "/api/eopcrf1/report-header", {
          [inp.dataset.header]: inp.value,
        });
        updateDetailsSummary(h);
      } catch (err) {
        alert(err.message);
      }
    });
  });

  // ================= Initial load =================
  async function init() {
    loadHeader();
    try {
      const data = await apiCall("GET", "/irc/eopcrf1/data");
      state.year = data.year;
      state.kras = data.kras;
      render();
    } catch (err) {
      workspaceEl.style.display = "none";
      emptyStateEl.style.display = "block";
      emptyStateTextEl.textContent =
        "Couldn't load this report: " + err.message;
    }
  }

  init();
})();
