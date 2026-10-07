(function () {
  const tab = document.getElementById("eopcrf4-tab");
  if (!tab) return;

  // ------------------------------------------------------------------
  // Layout of the two tables. Part IV-A is all free text. Part IV-B's
  // first two columns (Strengths / Improvement Needs) are picks from the
  // top-rated / lowest-rated items in EOPCRF I (objectives) and EOPCRF II
  // (competency subsections); everything else is free text.
  // Each table has exactly 3 fixed rows (position 1..3), matching the
  // printed form.
  // ------------------------------------------------------------------
  const PARTS = {
    A: {
      bodyId: "eopcrf4-table-body-a",
      columns: [
        { field: "gapAnalysis", type: "text", shaded: true },
        { field: "improvementArea", type: "text" },
        { field: "objective", type: "text" },
        { field: "intervention", type: "text" },
        { field: "timeline", type: "text" },
        { field: "resources", type: "text" },
      ],
    },
    B: {
      bodyId: "eopcrf4-table-body-b",
      columns: [
        {
          field: "strengthRef",
          type: "ref",
          direction: "highest",
          shaded: true,
        },
        { field: "devNeedsRef", type: "ref", direction: "lowest" },
        { field: "objective", type: "text" },
        { field: "intervention", type: "text" },
        { field: "timeline", type: "text" },
        { field: "resources", type: "text" },
      ],
    },
  };
  const POSITIONS = [1, 2, 3];
  const TOP_N = 5;

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
  // rows: { "A1": { part, position, ...fields, isLocked } }
  // items: pooled, flattened candidate list rebuilt fresh on every load
  //   [{ id, main, source, average }] -- "top 5" is a live computation.
  const state = {
    year: null,
    rows: {},
    feedback: { A: "", B: "" },
    items: [],
  };

  // ------------------------------------------------------------------
  // DOM refs
  // ------------------------------------------------------------------
  const bodies = {
    A: document.getElementById(PARTS.A.bodyId),
    B: document.getElementById(PARTS.B.bodyId),
  };
  const feedbackInputs = {
    A: document.getElementById("eopcrf4-feedback-a"),
    B: document.getElementById("eopcrf4-feedback-b"),
  };
  const approvingAuthorityName = document.getElementById(
    "eopcrf4ApprovingAuthorityName",
  );

  const resetBtn = document.getElementById("eopcrf4-reset-btn");
  const resetConfirmOverlay = document.getElementById(
    "eopcrf4-reset-confirm-overlay",
  );
  const resetConfirmCancelBtn = document.getElementById(
    "eopcrf4-reset-confirm-cancel",
  );
  const resetConfirmConfirmBtn = document.getElementById(
    "eopcrf4-reset-confirm-confirm",
  );

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
  function rankEopcrf1Objectives(data) {
    const items = [];
    (data.kras || []).forEach((kra) => {
      (kra.objectives || []).forEach((obj) => {
        if (obj.average === null || obj.average === undefined) return;
        items.push({
          id: `o:${obj.id}`,
          main: obj.text || "(untitled objective)",
          source: kra.text || "",
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
        average: avg,
      });
    });
    return items;
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
      loadApprovingAuthority();
    } catch (err) {
      ["A", "B"].forEach((part) => {
        bodies[part].innerHTML =
          `<tr class="eopcrf4-empty-row"><td colspan="7">Couldn't load this page: ${escapeHtml(err.message)}</td></tr>`;
      });
    }
  }

  // The Approving Authority's name is entered once on EOPCRF I and shared;
  // here it is only read, never edited.
  async function loadApprovingAuthority() {
    if (!approvingAuthorityName) return;
    try {
      const data = await apiCall("GET", "/api/eopcrf1/approving-authority");
      if (data && data.name) approvingAuthorityName.textContent = data.name;
    } catch (e) {
      // leave blank
    }
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
  // Render
  // ------------------------------------------------------------------
  function render() {
    renderTable("A");
    renderTable("B");
    ["A", "B"].forEach((part) => {
      feedbackInputs[part].value = state.feedback[part] || "";
    });
  }

  function renderRefDropdown(row, column) {
    const { field, direction } = column;
    const items = state.items;
    const currentRef = row[field];
    const candidates = topN(items, TOP_N, direction);

    // Always keep the currently-saved pick in the list, even if it has
    // fallen out of the top 5 since it was chosen, or -- if the item is
    // gone entirely -- show it as no-longer-available rather than
    // silently dropping the selection.
    let extra = null;
    if (currentRef && !candidates.some((c) => c.id === currentRef)) {
      const match = items.find((c) => c.id === currentRef);
      extra = match || {
        id: currentRef,
        main: "(previously selected — no longer available)",
        source: "",
        average: null,
        unavailable: true,
      };
    }

    const current = extra || items.find((c) => c.id === currentRef);
    const ranked = candidates.map((c, i) => ({ ...c, rank: i + 1 }));
    const allOptions = extra ? [{ ...extra, rank: null }, ...ranked] : ranked;

    const metaLine = (c) =>
      `${escapeHtml(c.source)}${c.source ? " &middot; " : ""}${c.average.toFixed(2)}`;

    const triggerInner = current
      ? `
        <span class="eopcrf4-ref-trigger-content">
          <span class="eopcrf4-ref-main">${escapeHtml(current.main)}</span>
          ${current.unavailable ? "" : `<span class="eopcrf4-ref-meta">${metaLine(current)}</span>`}
        </span>
      `
      : `<span class="eopcrf4-ref-trigger-text eopcrf4-ref-placeholder">— Select —</span>`;

    const rankClass =
      direction === "highest"
        ? "eopcrf4-ref-rank-positive"
        : "eopcrf4-ref-rank-negative";

    const optionsHtml = allOptions
      .map((c) => {
        const isSelected = c.id === currentRef;
        const metaHtml = c.unavailable
          ? ""
          : `<p class="eopcrf4-ref-meta">${metaLine(c)}</p>`;
        const rankHtml = c.rank
          ? `<span class="eopcrf4-ref-rank ${rankClass}">${c.rank}</span>`
          : `<span class="eopcrf4-ref-rank eopcrf4-ref-rank-neutral">&ndash;</span>`;
        return `
          <li role="option" class="eopcrf4-ref-option${isSelected ? " eopcrf4-ref-option-selected" : ""}" data-value="${escapeHtml(c.id)}" aria-selected="${isSelected}">
            ${rankHtml}
            <span class="eopcrf4-ref-option-text">
              <p class="eopcrf4-ref-main">${escapeHtml(c.main)}</p>
              ${metaHtml}
            </span>
          </li>
        `;
      })
      .join("");

    return `
      <div class="eopcrf4-ref-dropdown" data-field="${field}" data-part="${row.part}" data-position="${row.position}">
        <button type="button" class="eopcrf4-ref-trigger" aria-haspopup="listbox" aria-expanded="false">
          ${triggerInner}
          <span class="eopcrf4-ref-trigger-caret">&#9662;</span>
        </button>
        <ul class="eopcrf4-ref-listbox" role="listbox" hidden>
          <li role="option" class="eopcrf4-ref-option eopcrf4-ref-option-placeholder" data-value="" aria-selected="${!currentRef}">
            <p class="eopcrf4-ref-main">— Select —</p>
          </li>
          ${optionsHtml}
        </ul>
      </div>
    `;
  }

  // Locked view for a pick: plain read text, no dropdown present at all.
  function renderLockedRefCell(row, column, cls) {
    const currentRef = row[column.field];
    if (!currentRef) return `<td class="${cls}"></td>`;
    const match = state.items.find((c) => c.id === currentRef);
    if (!match) {
      return `<td class="${cls}"><span class="eopcrf4-cell-empty">(previously selected — no longer available)</span></td>`;
    }
    return `
      <td class="${cls}">
        <p class="eopcrf4-ref-main">${escapeHtml(match.main)}</p>
        <p class="eopcrf4-ref-meta">${escapeHtml(match.source)}${match.source ? " &middot; " : ""}${match.average.toFixed(2)}</p>
      </td>
    `;
  }

  function renderTextCell(row, column, cls) {
    const value = row[column.field] || "";
    if (row.isLocked) {
      return `<td class="eopcrf4-cell-text ${cls}">${escapeHtml(value)}</td>`;
    }
    return `<td class="${cls}"><textarea class="eopcrf4-cell-edit" data-field="${column.field}" rows="2">${escapeHtml(value)}</textarea></td>`;
  }

  function renderCell(row, column) {
    const cls = column.shaded ? "eopcrf4-col-shaded" : "";
    if (column.type === "ref") {
      return row.isLocked
        ? renderLockedRefCell(row, column, cls)
        : `<td class="${cls}">${renderRefDropdown(row, column)}</td>`;
    }
    return renderTextCell(row, column, cls);
  }

  function renderTable(part) {
    const def = PARTS[part];
    bodies[part].innerHTML = POSITIONS.map((position) => {
      const row = state.rows[rowKey(part, position)] || {
        part,
        position,
        isLocked: true,
      };
      return `
        <tr data-part="${part}" data-position="${position}">
          <td class="eopcrf4-col-edit">
            <button type="button" class="eopcrf4-icon-btn eopcrf4-toggle-lock-btn" data-part="${part}" data-position="${position}" title="${row.isLocked ? "Edit this row" : "Save & lock"}">
              ${row.isLocked ? "&#9998;" : "&#10003;"}
            </button>
          </td>
          ${def.columns.map((col) => renderCell(row, col)).join("")}
        </tr>
      `;
    }).join("");
  }

  // ------------------------------------------------------------------
  // Events
  // ------------------------------------------------------------------
  function closeAllDropdowns(exceptListbox) {
    tab.querySelectorAll(".eopcrf4-ref-listbox").forEach((listbox) => {
      if (listbox === exceptListbox) return;
      listbox.hidden = true;
      const trigger = listbox.previousElementSibling;
      if (trigger) trigger.setAttribute("aria-expanded", "false");
    });
  }

  ["A", "B"].forEach((part) => {
    const body = bodies[part];

    body.addEventListener("click", async (e) => {
      // Open/close a dropdown
      const trigger = e.target.closest(".eopcrf4-ref-trigger");
      if (trigger) {
        const listbox = trigger.nextElementSibling;
        const wasOpen = !listbox.hidden;
        closeAllDropdowns();
        listbox.hidden = wasOpen;
        trigger.setAttribute("aria-expanded", String(!wasOpen));
        return;
      }

      // Choose an option
      const option = e.target.closest(".eopcrf4-ref-option");
      if (option) {
        const dropdown = option.closest(".eopcrf4-ref-dropdown");
        const position = Number(dropdown.dataset.position);
        const field = dropdown.dataset.field;
        closeAllDropdowns();
        try {
          await saveRow(part, position, { [field]: option.dataset.value });
        } catch (err) {
          alert(err.message);
        }
        renderTable(part); // re-render either way (reverts on failure)
        return;
      }

      // Edit / save-and-lock toggle
      const btn = e.target.closest(".eopcrf4-toggle-lock-btn");
      if (btn) {
        const position = Number(btn.dataset.position);
        const row = state.rows[rowKey(part, position)];
        if (!row) return;

        btn.disabled = true;
        try {
          if (row.isLocked) {
            await saveRow(part, position, { isLocked: false });
          } else {
            // Commit whatever is currently typed, then lock.
            const tr = btn.closest("tr");
            const patch = { isLocked: true };
            tr.querySelectorAll("textarea.eopcrf4-cell-edit").forEach((ta) => {
              patch[ta.dataset.field] = ta.value;
            });
            await saveRow(part, position, patch);
          }
          renderTable(part);
        } catch (err) {
          alert(err.message);
        } finally {
          btn.disabled = false;
        }
        return;
      }

      if (!e.target.closest(".eopcrf4-ref-listbox")) closeAllDropdowns();
    });
  });

  document.addEventListener("click", (e) => {
    if (!tab.contains(e.target) || !e.target.closest(".eopcrf4-dev-table")) {
      closeAllDropdowns();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAllDropdowns();
  });

  // ------------------------------------------------------------------
  // Feedback boxes: saved when the box loses focus, or after a short
  // pause in typing.
  // ------------------------------------------------------------------
  const feedbackTimers = {};

  async function saveFeedback(part) {
    clearTimeout(feedbackTimers[part]);
    const text = feedbackInputs[part].value;
    if (text === (state.feedback[part] || "")) return;
    try {
      const saved = await apiCall("POST", "/irc/eopcrf4/feedback", {
        year: state.year,
        part,
        text,
      });
      state.feedback[part] = saved.text || "";
    } catch (err) {
      alert(err.message);
    }
  }

  ["A", "B"].forEach((part) => {
    const input = feedbackInputs[part];
    input.addEventListener("input", () => {
      clearTimeout(feedbackTimers[part]);
      feedbackTimers[part] = setTimeout(() => saveFeedback(part), 1000);
    });
    input.addEventListener("blur", () => saveFeedback(part));
  });

  // ------------------------------------------------------------------
  // Reset-page confirmation modal
  //
  // Single scope, no options -- everything on this page is the six fixed
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
  // Initial load
  // ------------------------------------------------------------------
  loadAll();
})();
