
(() => {
  "use strict";

  const core = window.DriveCostCore;
  if (!core) {
    console.error("DriveCostCore is unavailable.");
    return;
  }

  const $ = id => document.getElementById(id);
  const PRICE_KEY = "drivecost-v2-prices";
  const META_KEY = "drivecost-v2-price-metadata";

  const sourceLabels = {
    system_sample: "ข้อมูลตัวอย่างของระบบ",
    user: "ผู้ใช้กำหนดเอง",
    receipt: "ใบเสร็จ / สถานีบริการ",
    provider: "ผู้ให้บริการพลังงาน",
    company: "ราคาของบริษัท / องค์กร",
    external: "แหล่งข้อมูลภายนอก / API"
  };

  const sourceShortLabels = {
    system_sample: "ข้อมูลตัวอย่าง",
    user: "ผู้ใช้กำหนด",
    receipt: "มีหลักฐานใบเสร็จ",
    provider: "ผู้ให้บริการ",
    company: "ข้อมูลองค์กร",
    external: "แหล่งข้อมูลภายนอก"
  };

  function safeParse(value, fallback) {
    if (!value) return fallback;
    try {
      const parsed = JSON.parse(value);
      return parsed ?? fallback;
    } catch {
      return fallback;
    }
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

  function numberFrom(id) {
    const value = Number.parseFloat($(id)?.value);
    return Number.isFinite(value) ? value : 0;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    })[character]);
  }

  function defaultMeta(mode) {
    return {
      sourceType: "system_sample",
      sourceName: "DriveCost Sample Data",
      sourceUrl: "",
      note: "ข้อมูลตัวอย่างสำหรับการคำนวณ ไม่ใช่ราคาสด",
      updatedAt: null
    };
  }

  function getAllMetadata() {
    if (window.DriveCostPriceData?.getPriceMetadata) {
      return window.DriveCostPriceData.getPriceMetadata();
    }

    const saved = safeParse(storageGet(META_KEY), {});
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

  function getStoredPrice(mode = core.mode) {
    const saved = safeParse(storageGet(PRICE_KEY), {});
    const fallback = core.energyData[mode]?.price || 0;
    return Object.prototype.hasOwnProperty.call(saved, mode)
      ? Number(saved[mode])
      : Number(fallback);
  }

  function validSourceUrl(value) {
    if (!value) return null;
    try {
      const url = new URL(value, location.href);
      if (!["http:", "https:"].includes(url.protocol)) return null;
      return url.href;
    } catch {
      return null;
    }
  }

  function sourceUpdatedText(meta) {
    return meta.updatedAt
      ? new Date(meta.updatedAt).toLocaleString("th-TH")
      : "ยังไม่มีการแก้ไข";
  }

  function updateCurrentPriceSource(options = {}) {
    const mode = core.mode;
    const meta = getMeta(mode);
    const sourceLabel = sourceLabels[meta.sourceType] || "ไม่ระบุแหล่งข้อมูล";
    const priceInput = $("energyPrice");
    const storedPrice = getStoredPrice(mode);
    const livePrice = Number.parseFloat(priceInput?.value);
    const unsaved =
      options.forceUnsaved === true ||
      (Number.isFinite(livePrice) && Math.abs(livePrice - storedPrice) > 0.0001);

    const source = $("currentPriceSource");
    const updated = $("currentPriceUpdated");
    const inlineText = $("inlinePriceSourceText");
    const dot = $("inlinePriceSource")?.querySelector(".source-dot");

    if (unsaved) {
      source.textContent = "แก้ไขราคาในฟอร์ม";
      updated.textContent = "ยังไม่บันทึกแหล่งที่มา";
      inlineText.textContent = "แก้ไขในฟอร์ม • ยังไม่บันทึก";
      if (dot) dot.className = "source-dot unsaved";
    } else {
      source.textContent = meta.sourceName || sourceLabel;
      updated.textContent =
        meta.sourceType === "system_sample"
          ? "ข้อมูลตัวอย่าง • ไม่ใช่ราคาสด"
          : `${sourceLabel} • ${sourceUpdatedText(meta)}`;
      inlineText.textContent =
        meta.sourceType === "system_sample"
          ? "ข้อมูลตัวอย่างของระบบ • ไม่ใช่ราคาสด"
          : `${sourceLabel} • ${meta.sourceName || "ไม่ระบุชื่อ"}`;
      if (dot) dot.className = `source-dot ${meta.sourceType}`;
    }

    // Synchronize the System Status panel with the selected energy type.
    const statusSource = $("priceSourceValue");
    const statusUpdated = $("priceUpdatedValue");
    if (statusSource) {
      statusSource.textContent = unsaved
        ? "แก้ไขในฟอร์ม • ยังไม่บันทึก"
        : `${sourceLabel} • ${meta.sourceName || "ไม่ระบุชื่อ"}`;
      statusSource.className =
        unsaved || meta.sourceType === "system_sample" ? "warn" : "good";
    }
    if (statusUpdated) statusUpdated.textContent = sourceUpdatedText(meta);
  }

  function inputRows(result) {
    const distance = numberFrom("distance");
    const trips = Math.max(1, Math.floor(numberFrom("trips")));
    const passengers = Math.max(1, Math.floor(numberFrom("passengers")));
    const roundTrip = $("roundTrip")?.checked;
    const factorPercent =
      numberFrom("wheel") +
      numberFrom("load") +
      numberFrom("tune") +
      numberFrom("traffic") +
      numberFrom("hill") +
      numberFrom("ac");

    const energyUnit = core.mode === "ev"
      ? "kWh/100 กม."
      : core.mode === "ngv"
        ? "กม./กก."
        : "กม./ลิตร";

    return [
      ["รถ", core.vehicleData[core.vehicle]?.name || core.vehicle],
      ["ระบบพลังงาน", core.energyData[core.mode]?.name || core.mode],
      ["ชนิดพลังงาน", $("energyType")?.value || ""],
      ["ระยะทางต่อเที่ยว", `${fmt(distance, 1)} กม.`],
      ["จำนวนเที่ยว", `${trips} เที่ยว`],
      ["ไป-กลับ", roundTrip ? "ใช่ • คูณ 2" : "ไม่"],
      ["ผู้โดยสาร", `${passengers} คน`],
      ["อัตราสิ้นเปลือง", `${fmt(numberFrom("efficiency"), 2)} ${energyUnit}`],
      ["ราคาพลังงาน", `${fmt(numberFrom("energyPrice"), 2)} ${$("priceUnit")?.textContent || ""}`],
      ["ตัวปรับสภาพจริง", `${fmt(result.multiplier, 2)}× • ${factorPercent >= 0 ? "+" : ""}${fmt(factorPercent, 0)}%`]
    ];
  }

  function buildFormulaSteps(result) {
    const distance = Math.max(0, numberFrom("distance"));
    const trips = Math.max(1, Math.floor(numberFrom("trips")));
    const passengers = Math.max(1, Math.floor(numberFrom("passengers")));
    const roundMultiplier = $("roundTrip")?.checked ? 2 : 1;
    const efficiency = Math.max(0.0001, numberFrom("efficiency"));
    const price = Math.max(0, numberFrom("energyPrice"));
    const toll = Math.max(0, numberFrom("toll"));
    const parking = Math.max(0, numberFrom("parking"));
    const other = Math.max(0, numberFrom("other"));

    const factorValues = {
      wheel: numberFrom("wheel"),
      load: numberFrom("load"),
      tune: numberFrom("tune"),
      traffic: numberFrom("traffic"),
      hill: numberFrom("hill"),
      ac: numberFrom("ac")
    };

    const factorPercent = Object.values(factorValues).reduce((sum, value) => sum + value, 0);
    const multiplier = Math.max(0.1, 1 + factorPercent / 100);
    const totalDistance = distance * trips * roundMultiplier;

    const isEv = core.mode === "ev";
    const energyUnit = isEv ? "kWh" : core.mode === "ngv" ? "กก." : "ลิตร";
    const baseEnergy = isEv
      ? totalDistance * (efficiency / 100)
      : totalDistance / efficiency;

    const adjustedEnergy = baseEnergy * multiplier;
    const energyCost = adjustedEnergy * price;
    const extras = toll + parking + other;
    const total = energyCost + extras;
    const perKm = total / Math.max(1, totalDistance);
    const perPerson = total / passengers;

    const baseFormula = isEv
      ? `${fmt(totalDistance, 2)} × (${fmt(efficiency, 2)} ÷ 100)`
      : `${fmt(totalDistance, 2)} ÷ ${fmt(efficiency, 2)}`;

    const factorExpression =
      `1 + (${fmt(factorValues.wheel, 0)} + ${fmt(factorValues.load, 0)} + ` +
      `${fmt(factorValues.tune, 0)} + ${fmt(factorValues.traffic, 0)} + ` +
      `${fmt(factorValues.hill, 0)} + ${fmt(factorValues.ac, 0)}) ÷ 100`;

    return [
      {
        title: "คำนวณระยะทางรวม",
        expression: `${fmt(distance, 2)} × ${trips} × ${roundMultiplier}`,
        result: `${fmt(totalDistance, 2)} กม.`,
        note: roundMultiplier === 2 ? "รวมไป-กลับ" : "เที่ยวเดียว"
      },
      {
        title: "คำนวณพลังงานพื้นฐาน",
        expression: baseFormula,
        result: `${fmt(baseEnergy, 3)} ${energyUnit}`,
        note: isEv ? "จาก kWh/100 กม." : "ก่อนปรับสภาพใช้งาน"
      },
      {
        title: "คำนวณตัวคูณสภาพใช้งานจริง",
        expression: factorExpression,
        result: `${fmt(multiplier, 3)}×`,
        note: `${factorPercent >= 0 ? "เพิ่ม" : "ลด"} ${fmt(Math.abs(factorPercent), 0)}%`
      },
      {
        title: "ปรับปริมาณพลังงาน",
        expression: `${fmt(baseEnergy, 3)} × ${fmt(multiplier, 3)}`,
        result: `${fmt(adjustedEnergy, 3)} ${energyUnit}`,
        note: "พลังงานที่ใช้โดยประมาณ"
      },
      {
        title: "คำนวณค่าพลังงาน",
        expression: `${fmt(adjustedEnergy, 3)} × ${fmt(price, 2)}`,
        result: `${fmt(energyCost, 2)} บาท`,
        note: "ปริมาณพลังงาน × ราคาต่อหน่วย"
      },
      {
        title: "รวมค่าใช้จ่ายอื่น",
        expression: `${fmt(toll, 2)} + ${fmt(parking, 2)} + ${fmt(other, 2)}`,
        result: `${fmt(extras, 2)} บาท`,
        note: "ทางด่วน + จอดรถ + ค่าอื่น"
      },
      {
        title: "ต้นทุนรวม",
        expression: `${fmt(energyCost, 2)} + ${fmt(extras, 2)}`,
        result: `${fmt(total, 2)} บาท`,
        note: "ค่าพลังงาน + ค่าใช้จ่ายอื่น",
        final: true
      },
      {
        title: "ต้นทุนต่อกิโลเมตร",
        expression: `${fmt(total, 2)} ÷ ${fmt(totalDistance, 2)}`,
        result: `${fmt(perKm, 2)} บาท/กม.`,
        note: "ใช้ระยะทางรวม"
      },
      {
        title: "ต้นทุนเฉลี่ยต่อคน",
        expression: `${fmt(total, 2)} ÷ ${passengers}`,
        result: `${fmt(perPerson, 2)} บาท/คน`,
        note: "หารตามจำนวนผู้โดยสาร"
      }
    ];
  }

  function renderCalculationDetails() {
    const result = core.calculate();
    const meta = getMeta(core.mode);
    const sourceLabel = sourceLabels[meta.sourceType] || "ไม่ระบุ";
    const steps = buildFormulaSteps(result);

    $("detailTotalCost").textContent = `${fmt(result.total, 2)} บาท`;
    $("detailCalculationTime").textContent =
      `คำนวณจากข้อมูลปัจจุบัน • ${new Date().toLocaleString("th-TH")}`;

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

    $("calculationInputs").innerHTML = inputRows(result).map(([label, value]) => `
      <div class="audit-row">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
      </div>
    `).join("");

    const badge = $("detailSourceBadge");
    badge.textContent = sourceShortLabels[meta.sourceType] || sourceLabel;
    badge.className = `source-status-badge ${meta.sourceType}`;

    $("detailSourceName").textContent = meta.sourceName || sourceLabel;
    $("detailSourceNote").textContent =
      meta.note || (
        meta.sourceType === "system_sample"
          ? "ข้อมูลตัวอย่างสำหรับการคำนวณ ไม่ใช่ราคาสด"
          : sourceLabel
      );
    $("detailSourceUpdated").textContent = sourceUpdatedText(meta);

    const sourceLink = $("detailSourceLink");
    const safeUrl = validSourceUrl(meta.sourceUrl);
    if (safeUrl) {
      sourceLink.href = safeUrl;
      sourceLink.hidden = false;
    } else {
      sourceLink.removeAttribute("href");
      sourceLink.hidden = true;
    }

    updateCurrentPriceSource();
  }

  function handlePriceInput() {
    updateCurrentPriceSource({ forceUnsaved: true });
  }

  // Current result provenance.
  $("energyPrice")?.addEventListener("input", handlePriceInput);
  $("energyType")?.addEventListener("change", () => updateCurrentPriceSource());

  window.addEventListener("drivecost:modechange", () => {
    setTimeout(() => updateCurrentPriceSource(), 20);
  });
  window.addEventListener("drivecost:vehiclechange", () => {
    setTimeout(() => updateCurrentPriceSource(), 30);
  });
  window.addEventListener("drivecost:pricesourcechange", () => {
    setTimeout(() => {
      updateCurrentPriceSource();
      if ($("page-calculation-details")?.classList.contains("active")) {
        renderCalculationDetails();
      }
    }, 30);
  });
  window.addEventListener("drivecost:calculated", () => {
    updateCurrentPriceSource();
  });

  // The price page can be re-rendered by app-v2.js; attach helper behavior after navigation.
  document.querySelector('[data-page="energy"]')?.addEventListener("click", () => {
    setTimeout(() => updateCurrentPriceSource(), 50);
  });

  updateCurrentPriceSource();

  window.DriveCostProvenance = {
    getMeta,
    getAllMetadata,
    renderCalculationDetails,
    updateCurrentPriceSource,
    sourceLabels,
    formulaVersion: "1.2.0"
  };
})();
