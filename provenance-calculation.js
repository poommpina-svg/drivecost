(() => {
  "use strict";

  const core = window.DriveCostCore;
  if (!core) return;

  const $ = id => document.getElementById(id);
  const META_KEY = "drivecost-v2-price-metadata";

  const sourceLabels = {
    system_sample: "ข้อมูลตัวอย่างของระบบ",
    user: "ผู้ใช้กำหนดเอง",
    receipt: "ใบเสร็จ / สถานีบริการ",
    provider: "ผู้ให้บริการพลังงาน",
    company: "ราคาของบริษัท / องค์กร",
    external: "แหล่งข้อมูลภายนอก / API"
  };

  function parse(value, fallback) {
    if (!value) return fallback;
    try { return JSON.parse(value) ?? fallback; }
    catch { return fallback; }
  }

  function storageGet(key) {
    try { return localStorage.getItem(key); }
    catch { return null; }
  }

  function fmt(value, digits = 2) {
    return Number(value || 0).toLocaleString("th-TH", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;",
      '"': "&quot;", "'": "&#039;"
    })[character]);
  }

  function defaultMeta(mode) {
    return {
      sourceType: "system_sample",
      sourceName: "DriveCost Sample Data",
      sourceUrl: "",
      note: "ข้อมูลตัวอย่างสำหรับการคำนวณ ไม่ใช่ราคาสด",
      updatedAt: null,
      mode
    };
  }

  function getAllMetadata() {
    if (window.DriveCostPriceData?.getPriceMetadata) {
      return window.DriveCostPriceData.getPriceMetadata();
    }
    const saved = parse(storageGet(META_KEY), {});
    return Object.fromEntries(
      Object.keys(core.energyData).map(mode => [
        mode,
        Object.assign(defaultMeta(mode), saved[mode] || {})
      ])
    );
  }

  function getMeta(mode = core.mode) {
    return getAllMetadata()[mode] || defaultMeta(mode);
  }

  function sourceUpdatedText(meta) {
    return meta.updatedAt
      ? new Date(meta.updatedAt).toLocaleString("th-TH")
      : "ยังไม่มีการแก้ไข";
  }

  function validSourceUrl(value) {
    if (!value) return null;
    try {
      const url = new URL(value, location.href);
      return ["http:", "https:"].includes(url.protocol) ? url.href : null;
    } catch {
      return null;
    }
  }

  function updateCurrentPriceSource(options = {}) {
    if (core.calculationMode === "actual") {
      const result = core.lastResult || core.calculate();
      if ($("trustBarLabel")) $("trustBarLabel").textContent = "คุณภาพข้อมูลจริง";
      if ($("currentPriceSource")) $("currentPriceSource").textContent =
        result.confidence?.label || "ยอดเติมจริง";
      if ($("currentPriceUpdated")) $("currentPriceUpdated").textContent =
        result.confidence?.detail || "ใช้ข้อมูลเลขไมล์และใบเสร็จ";
      if ($("inlinePriceSourceText")) $("inlinePriceSourceText").textContent =
        "ราคาในโหมดนี้มาจากยอดที่จ่ายจริง";
      if ($("inlineLiveRefreshButton")) $("inlineLiveRefreshButton").hidden = true;
      return;
    }

    const meta = getMeta(core.mode);
    const sourceLabel = sourceLabels[meta.sourceType] || "ไม่ระบุแหล่งข้อมูล";
    const storedPrice = Number(core.energyData[core.mode]?.price || 0);
    const livePrice = Number.parseFloat($("energyPrice")?.value);
    const unsaved = options.forceUnsaved === true ||
      (Number.isFinite(livePrice) && Math.abs(livePrice - storedPrice) > 0.0001);

    if ($("trustBarLabel")) $("trustBarLabel").textContent = "แหล่งราคาพลังงาน";
    if ($("currentPriceSource")) $("currentPriceSource").textContent = unsaved
      ? "แก้ไขราคาในฟอร์ม"
      : meta.sourceName || sourceLabel;
    if ($("currentPriceUpdated")) $("currentPriceUpdated").textContent = unsaved
      ? "ยังไม่บันทึกแหล่งที่มา"
      : meta.sourceType === "system_sample"
        ? "ข้อมูลตัวอย่าง • ไม่ใช่ราคาสด"
        : `${sourceLabel} • ${sourceUpdatedText(meta)}`;
    if ($("inlinePriceSourceText")) $("inlinePriceSourceText").textContent = unsaved
      ? "แก้ไขในฟอร์ม • ยังไม่บันทึก"
      : `${sourceLabel} • ${meta.sourceName || "ไม่ระบุชื่อ"}`;
    if ($("inlineLiveRefreshButton")) $("inlineLiveRefreshButton").hidden = false;

    const dot = $("inlinePriceSource")?.querySelector(".source-dot");
    if (dot) dot.className = `source-dot ${unsaved ? "unsaved" : meta.sourceType}`;
  }

  function detailSource(result) {
    if (result.calculationMode === "actual") {
      return {
        sourceType: "receipt",
        sourceName: "ยอดเติมจริงที่ผู้ใช้กรอก",
        note: result.confidence?.detail || "อ้างอิงเลขไมล์และใบเสร็จ",
        updatedAt: new Date().toISOString(),
        sourceUrl: ""
      };
    }
    return getMeta(core.mode);
  }

  function renderCalculationDetails() {
    const result = core.calculate();
    const meta = detailSource(result);
    const steps = Array.isArray(result.steps) ? result.steps : [];
    const inputs = Array.isArray(result.inputs) ? result.inputs : [];

    if ($("detailTotalCost")) $("detailTotalCost").textContent = `${fmt(result.total, 2)} บาท`;
    if ($("detailCalculationTime")) {
      $("detailCalculationTime").textContent =
        `${result.calculationLabel} • ${new Date().toLocaleString("th-TH")}`;
    }

    if ($("formulaSteps")) {
      $("formulaSteps").innerHTML = steps.map((step, index) => `
        <article class="formula-step ${step.final ? "final" : ""}">
          <span class="formula-step-number">${index + 1}</span>
          <div class="formula-step-copy">
            <strong>${escapeHtml(step.title)}</strong>
            <code class="formula-expression">${escapeHtml(step.expression)}</code>
          </div>
          <div class="formula-step-result">
            <strong>${escapeHtml(step.result)}</strong>
            <span>${escapeHtml(step.note)}</span>
          </div>
        </article>
      `).join("");
    }

    if ($("calculationInputs")) {
      $("calculationInputs").innerHTML = inputs.map(([label, value]) => `
        <div class="audit-row">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
        </div>
      `).join("");
    }

    const sourceType = meta.sourceType || "user";
    if ($("detailSourceBadge")) {
      $("detailSourceBadge").textContent = sourceLabels[sourceType] || "ข้อมูลผู้ใช้";
      $("detailSourceBadge").className = `source-status-badge ${sourceType}`;
    }
    if ($("detailSourceName")) $("detailSourceName").textContent =
      meta.sourceName || sourceLabels[sourceType] || "ไม่ระบุ";
    if ($("detailSourceNote")) $("detailSourceNote").textContent = meta.note || "—";
    if ($("detailSourceUpdated")) $("detailSourceUpdated").textContent =
      sourceUpdatedText(meta);

    const sourceLink = $("detailSourceLink");
    const safeUrl = validSourceUrl(meta.sourceUrl);
    if (sourceLink) {
      if (safeUrl) {
        sourceLink.href = safeUrl;
        sourceLink.hidden = false;
      } else {
        sourceLink.removeAttribute("href");
        sourceLink.hidden = true;
      }
    }

    updateCurrentPriceSource();
  }

  $("energyPrice")?.addEventListener("input", () =>
    updateCurrentPriceSource({ forceUnsaved: true })
  );
  $("energyType")?.addEventListener("change", () => updateCurrentPriceSource());

  [
    "drivecost:modechange",
    "drivecost:vehiclechange",
    "drivecost:calculationmodechange",
    "drivecost:pricesourcechange",
    "drivecost:calculated"
  ].forEach(eventName => {
    window.addEventListener(eventName, () => {
      setTimeout(() => {
        updateCurrentPriceSource();
        if ($("page-calculation-details")?.classList.contains("active")) {
          renderCalculationDetails();
        }
      }, 20);
    });
  });

  updateCurrentPriceSource();

  window.DriveCostProvenance = {
    getMeta,
    getAllMetadata,
    renderCalculationDetails,
    updateCurrentPriceSource,
    sourceLabels,
    formulaVersion: "2.0.0"
  };
})();
