(function () {
  const tableEl = document.getElementById("eopcrf3-summary-table");
  if (!tableEl) return;

  const scoreEls = {
    "1a": document.getElementById("eopcrf3-score-1a"),
    "1b": document.getElementById("eopcrf3-score-1b"),
    "1c": document.getElementById("eopcrf3-score-1c"),
    "2a": document.getElementById("eopcrf3-score-2a"),
    "2b": document.getElementById("eopcrf3-score-2b"),
  };
  const overallEl = document.getElementById("eopcrf3-overall-score");
  const pmesNumericalEl = document.getElementById("eopcrf3-pmes-numerical");
  const pmesAdjectivalEl = document.getElementById("eopcrf3-pmes-adjectival");
  const superiorNameEl = document.getElementById("eopcrf3-superior-name");

  // Part II-A / II-B each count for 2.5% of the final score: the section
  // average x 0.025 -- same constant eopcrf2.js uses for its
  // .eopcrf2-section-footer-value.
  const PART2_WEIGHT = 0.025;

  // PMES Rating Table (right-hand table on the form).
  const PMES_BANDS = [
    { min: 4.5, numerical: 5, label: "Outstanding", cls: "outstanding" },
    {
      min: 3.5,
      numerical: 4,
      label: "Very Satisfactory",
      cls: "very-satisfactory",
    },
    { min: 2.5, numerical: 3, label: "Satisfactory", cls: "satisfactory" },
    { min: 1.5, numerical: 2, label: "Unsatisfactory", cls: "unsatisfactory" },
    { min: -Infinity, numerical: 1, label: "Poor", cls: "poor" },
  ];

  // The Part II section keys, as stored by EOPCRF2Rating.section_key.
  const SECTION_LEADERSHIP = "leadership";
  const SECTION_CBC = "cbc";

  // ================= API helper =================
  async function apiGet(url) {
    let res;
    try {
      res = await fetch(url);
    } catch (e) {
      throw new Error(
        "Network error — please check your connection and try again.",
      );
    }
    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      // no/invalid JSON body — fall through with data = null
    }
    if (!res.ok) {
      throw new Error(
        (data && data.error) || "Something went wrong. Please try again.",
      );
    }
    return data;
  }

  // ================= Helpers =================
  // Four decimals so Part I and Part II scores (Part II's are avg x 0.025)
  // add up to the Overall Score exactly as displayed.
  function fmtScore(n) {
    if (n === null || n === undefined || isNaN(n)) return "—";
    return Number(n).toFixed(4);
  }

  function average(values) {
    const rated = values.filter((v) => v !== null && v !== undefined);
    if (rated.length === 0) return null;
    return rated.reduce((sum, v) => sum + v, 0) / rated.length;
  }

  // Same figure as the "Overall Rating" (eopcrf1-summary-value) shown on
  // each Part I tab: the sum of that part's objective scores, or null when
  // nothing in the part has a score yet.
  function part1Score(kras, part) {
    let sum = 0;
    let hasAny = false;
    kras
      .filter((k) => k.part === part)
      .forEach((kra) => {
        (kra.objectives || []).forEach((o) => {
          if (o.score !== null && o.score !== undefined) {
            sum += o.score;
            hasAny = true;
          }
        });
      });
    return hasAny ? sum : null;
  }

  // Same figure as eopcrf2's .eopcrf2-section-footer-value: the average of
  // the section's subsection averages x 0.025, or null when nothing in the
  // section is rated.
  function part2Score(ratings, subToSection, sectionKey) {
    const subAverages = [];
    Object.keys(ratings || {}).forEach((subKey) => {
      if (subToSection[subKey] !== sectionKey) return;
      const sa = average(Object.values(ratings[subKey]));
      if (sa !== null) subAverages.push(sa);
    });
    const secAvg = average(subAverages);
    return secAvg === null ? null : secAvg * PART2_WEIGHT;
  }

  function pmesBand(overall) {
    // Compare at the form's 3-decimal precision so e.g. 4.4996 reads as
    // 4.500 and falls in the 4.500-5.000 band, as on the PMES table.
    const rounded = Math.round(overall * 1000) / 1000;
    return PMES_BANDS.find((b) => rounded >= b.min);
  }

  // ================= Render =================
  function render(kras, ratings, subToSection) {
    const scores = {
      "1a": part1Score(kras, "a"),
      "1b": part1Score(kras, "b"),
      "1c": part1Score(kras, "c"),
      "2a": part2Score(ratings, subToSection, SECTION_LEADERSHIP),
      "2b": part2Score(ratings, subToSection, SECTION_CBC),
    };

    Object.keys(scoreEls).forEach((key) => {
      scoreEls[key].textContent = fmtScore(scores[key]);
    });

    const present = Object.values(scores).filter((v) => v !== null);
    pmesNumericalEl.className = "eopcrf3-center eopcrf3-pmes";
    pmesAdjectivalEl.className = "eopcrf3-center eopcrf3-pmes";

    if (present.length === 0) {
      overallEl.textContent = "—";
      pmesNumericalEl.textContent = "";
      pmesAdjectivalEl.textContent = "";
      return;
    }

    const overall = present.reduce((sum, v) => sum + v, 0);
    overallEl.textContent = fmtScore(overall);

    const band = pmesBand(overall);
    pmesNumericalEl.textContent = String(band.numerical);
    pmesAdjectivalEl.textContent = band.label;
    pmesNumericalEl.classList.add("eopcrf3-pmes--" + band.cls);
    pmesAdjectivalEl.classList.add("eopcrf3-pmes--" + band.cls);
  }

  function showError(message) {
    const errBox = document.createElement("div");
    errBox.className = "eopcrf3-load-error";
    errBox.textContent = "Couldn't load this report: " + message;
    const flow = document.querySelector(".eopcrf3-flow");
    flow.parentNode.insertBefore(errBox, flow);
  }

  // ================= Initial load =================
  // Pure read-only view: nothing is stored for EOPCRF3. Obtained scores
  // come from EOPCRF1's and EOPCRF2's own data endpoints. "Name of
  // Employee" is the Home page's "Welcome, ___" name, filled in by
  // index.js (#reportPreparedByName) like every other signatory block;
  // "Name of Superior" comes from the rater name typed on EOPCRF1.
  async function init() {
    try {
      const [part1, part2, header] = await Promise.all([
        apiGet("/irc/eopcrf1/data"),
        apiGet("/irc/eopcrf2/data"),
        apiGet("/api/eopcrf1/report-header").catch(() => null),
      ]);
      render(part1.kras || [], part2.ratings || {}, part2.sections || {});
      if (header) {
        superiorNameEl.value = header.nameOfRater || "";
      }
    } catch (err) {
      showError(err.message);
    }
  }

  // "Name of Superior" is typeable. It's the same value as "Name of Rater"
  // on EOPCRF Part I, so it saves to the same report-header record (a
  // partial body, so no other header field is touched) and the two pages
  // always agree.
  let lastSavedSuperior = null;
  superiorNameEl.addEventListener("focus", () => {
    lastSavedSuperior = superiorNameEl.value;
  });
  superiorNameEl.addEventListener("blur", async () => {
    const value = superiorNameEl.value.trim();
    superiorNameEl.value = value;
    if (value === (lastSavedSuperior || "").trim()) return;
    try {
      const res = await fetch("/api/eopcrf1/report-header", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nameOfRater: value }),
      });
      if (!res.ok) throw new Error("save failed");
      lastSavedSuperior = value;
    } catch (e) {
      console.error("Couldn't save Name of Superior:", e);
    }
  });
  superiorNameEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") superiorNameEl.blur();
  });

  init();
})();
