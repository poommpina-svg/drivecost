(() => {
  "use strict";

  const engine = window.DriveCostEngine;
  if (!engine) {
    console.error("DriveCostEngine is unavailable.");
    return;
  }

  const $ = id => document.getElementById(id);
  const ACTUAL_RECORDS_KEY = "drivecost-v3-actual-fill-records";

  let mode = "fuel";
  let vehicle = "sedan";
  let calculationMode = "actual";
  let lastResult = null;
  let previousPrimaryKind = "fuel";

  const vehicleData = {
    sedan:  { name: "รถเก๋ง", label: "Sedan 3D • Dark Metallic", image: "/assets/sedan-3d.webp", defaultMode: "fuel", eff: 15, mass: 1350 },
    suv:    { name: "SUV", label: "SUV 3D • Dark Metallic", image: "/assets/suv-3d.webp", defaultMode: "fuel", eff: 10, mass: 1750 },
    pickup: { name: "รถกระบะ", label: "Pickup 3D • Dark Metallic", image: "/assets/pickup-3d.webp", defaultMode: "diesel", eff: 11, mass: 1900 },
    van:    { name: "รถตู้ / MPV", label: "Van 3D • Silver Metallic", image: "/assets/van-3d.webp", defaultMode: "diesel", eff: 9.5, mass: 2100 },
    hybrid: { name: "ไฮบริด", label: "Hybrid 3D • Pearl Silver", image: "/assets/hybrid-3d.webp", defaultMode: "hybrid", eff: 22, mass: 1500 },
    ev:     { name: "รถไฟฟ้า", label: "EV 3D • Pearl White", image: "/assets/ev-3d.webp", defaultMode: "ev", eff: 16, mass: 1850 }
  };

  const energyData = {
    fuel: {
      name: "น้ำมันเบนซิน / แก๊สโซฮอล์",
      types: ["แก๊สโซฮอล์ E20", "แก๊สโซฮอล์ 95", "แก๊สโซฮอล์ 91", "เบนซิน 95", "เบนซิน 91", "แก๊สโซฮอล์ E85"],
      eff: 15,
      price: 31.69,
      effUnit: "กม./ลิตร",
      priceUnit: "บาท/ลิตร"
    },
    diesel: {
      name: "ดีเซล",
      types: ["ดีเซล B7", "ดีเซล B10", "ดีเซล B20", "ดีเซลพรีเมียม", "ดีเซล"],
      eff: 14,
      price: 33.5,
      effUnit: "กม./ลิตร",
      priceUnit: "บาท/ลิตร"
    },
    lpg: {
      name: "LPG",
      types: ["LPG"],
      eff: 10,
      price: 15.5,
      effUnit: "กม./ลิตร",
      priceUnit: "บาท/ลิตร"
    },
    ngv: {
      name: "NGV",
      types: ["NGV"],
      eff: 12,
      price: 18.8,
      effUnit: "กม./กก.",
      priceUnit: "บาท/กก."
    },
    hybrid: {
      name: "ไฮบริด",
      types: ["แก๊สโซฮอล์ 95", "แก๊สโซฮอล์ E20", "เบนซิน 95", "Plug-in Hybrid"],
      eff: 22,
      price: 31.69,
      effUnit: "กม./ลิตร",
      priceUnit: "บาท/ลิตร"
    },
    ev: {
      name: "ไฟฟ้า",
      types: ["ไฟบ้าน", "ชาร์จ AC", "ชาร์จ DC"],
      eff: 16,
      price: 4.2,
      effUnit: "kWh/100 กม.",
      priceUnit: "บาท/kWh"
    }
  };

  const energyTypeAliases = Object.freeze({
    "E20": "แก๊สโซฮอล์ E20",
    "E85": "แก๊สโซฮอล์ E85",
    "แก๊สโซฮอล์E20": "แก๊สโซฮอล์ E20",
    "แก๊สโซฮอล์E85": "แก๊สโซฮอล์ E85",
    "แก๊สโซฮอล์91": "แก๊สโซฮอล์ 91",
    "แก๊สโซฮอล์95": "แก๊สโซฮอล์ 95",
    "เบนซิน91": "เบนซิน 91",
    "เบนซิน95": "เบนซิน 95",
    "ดีเซลB7": "ดีเซล B7",
    "ดีเซลB10": "ดีเซล B10",
    "ดีเซลB20": "ดีเซล B20",
    "ไฮบริด เบนซิน": "แก๊สโซฮอล์ 95"
  });

  function normalizeEnergyType(value) {
    const text = String(value || "").trim();
    return energyTypeAliases[text] || text;
  }

  const inputIds = [
    "energyType", "efficiency", "energyPrice",
    "actualUseDirectDistance", "actualOdometerStart", "actualOdometerEnd",
    "actualDirectDistance", "actualSource1Type", "actualSource1Quantity",
    "actualSource1Cost", "actualSource2Type", "actualSource2Quantity",
    "actualSource2Cost", "actualSource3Type", "actualSource3Quantity",
    "actualSource3Cost", "actualFillMethod", "actualRecordNote",
    "estimateDistance", "estimateOneWayDistance", "estimateRoundTrip",
    "estimateTripCount", "estimateDriverPreset", "estimateDriverCustom",
    "mountainDistance", "mountainOneWayDistance", "mountainRoundTrip",
    "mountainTripCount", "mountainElevationScope", "mountainAscent", "mountainDescent",
    "mountainVehicleMass", "mountainPayload", "mountainMaxGrade",
    "mountainDriverPreset", "mountainDriverCustom", "mountainTraffic",
    "mountainAc", "mountainRoad"
  ];

  function number(id, fallback = 0) {
    const value = Number.parseFloat($(id)?.value);
    return Number.isFinite(value) ? value : fallback;
  }

  function fmt(value, digits = 2) {
    return Number(value || 0).toLocaleString("th-TH", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function parse(value, fallback) {
    if (!value) return fallback;
    try {
      const result = JSON.parse(value);
      return result ?? fallback;
    } catch {
      return fallback;
    }
  }

  function storageGet(key) {
    try { return localStorage.getItem(key); }
    catch { return null; }
  }

  function storageSet(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }

  function toast(message) {
    const element = $("toast");
    if (!element) return;
    element.textContent = message;
    element.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => element.classList.remove("show"), 1800);
  }

  function actualRecords() {
    const records = parse(storageGet(ACTUAL_RECORDS_KEY), []);
    return Array.isArray(records) ? records : [];
  }

  function driverProfile() {
    return engine.buildDriverProfile(actualRecords(), vehicle, mode);
  }

  function driverFactor(presetId, customId) {
    const preset = $(presetId)?.value || "normal";
    const profile = driverProfile();

    if (preset === "learned") return profile.available ? profile.factor : 1;
    if (preset === "smooth") return 0.92;
    if (preset === "heavy") return 1.15;
    if (preset === "custom") {
      return Math.min(1.7, Math.max(0.65, 1 + number(customId) / 100));
    }
    return 1;
  }

  function primarySourceKind(nextMode = mode) {
    return engine.energyKindForMode(nextMode);
  }

  function updateSourceUnits() {
    [1, 2, 3].forEach(index => {
      const kind = $(`actualSource${index}Type`)?.value || "";
      const unit = engine.ENERGY[kind]?.unit || "—";
      const unitElement = $(`actualSource${index}Unit`);
      if (unitElement) unitElement.textContent = unit;
    });
  }

  function updateActualDistance() {
    const direct = $("actualUseDirectDistance")?.checked;
    const start = number("actualOdometerStart");
    const end = number("actualOdometerEnd");
    const distance = direct
      ? Math.max(0, number("actualDirectDistance"))
      : Math.max(0, end - start);

    if ($("odometerFields")) $("odometerFields").hidden = direct;
    if ($("directDistanceField")) $("directDistanceField").hidden = !direct;
    if ($("actualDistanceOutput")) $("actualDistanceOutput").textContent = fmt(distance, 1);
    return distance;
  }


  function selectedTripMethod(prefix) {
    return document.querySelector(
      `input[name="${prefix}DistanceMethod"]:checked`
    )?.value === "direct"
      ? "direct"
      : "leg";
  }

  function setTripMethod(prefix, method) {
    const safeMethod = method === "direct" ? "direct" : "leg";
    document.querySelectorAll(
      `input[name="${prefix}DistanceMethod"]`
    ).forEach(radio => {
      radio.checked = radio.value === safeMethod;
    });
  }

  function tripPlan(prefix) {
    return engine.resolveTripDistance({
      method: selectedTripMethod(prefix),
      directDistance: number(`${prefix}Distance`),
      oneWayDistance: number(`${prefix}OneWayDistance`),
      roundTrip: Boolean($(`${prefix}RoundTrip`)?.checked),
      tripCount: number(`${prefix}TripCount`, 1)
    });
  }

  function updateMountainElevation(trip = tripPlan("mountain")) {
    const elevation = engine.resolveElevation({
      scope: $("mountainElevationScope")?.value || "whole_trip",
      ascent: number("mountainAscent"),
      descent: number("mountainDescent")
    }, trip);

    if ($("mountainAscentOutput")) {
      $("mountainAscentOutput").textContent = `${fmt(elevation.ascent, 0)} ม.`;
    }
    if ($("mountainDescentOutput")) {
      $("mountainDescentOutput").textContent = `${fmt(elevation.descent, 0)} ม.`;
    }
    if ($("mountainElevationEquation")) {
      $("mountainElevationEquation").textContent =
        elevation.scope === "per_leg" && trip.method === "leg"
          ? `${fmt(elevation.ascentInput, 0)} × ${elevation.multiplier} = ${fmt(elevation.ascent, 0)} ม. ขึ้น • ${fmt(elevation.descentInput, 0)} × ${elevation.multiplier} = ${fmt(elevation.descent, 0)} ม. ลง`
          : `ใช้ค่ารวมทั้งทริปโดยตรง: ขึ้น ${fmt(elevation.ascent, 0)} ม. • ลง ${fmt(elevation.descent, 0)} ม.`;
    }

    return elevation;
  }

  function updateTripPlanner(prefix) {
    const trip = tripPlan(prefix);
    const legPanel = $(`${prefix}LegDistancePanel`);
    const directPanel = $(`${prefix}DirectDistancePanel`);
    const isDirect = trip.method === "direct";

    if (legPanel) legPanel.hidden = isDirect;
    if (directPanel) directPanel.hidden = !isDirect;

    if ($(`${prefix}DistanceOutput`)) {
      $(`${prefix}DistanceOutput`).textContent = fmt(trip.totalDistance, 1);
    }
    if ($(`${prefix}DirectOutput`)) {
      $(`${prefix}DirectOutput`).textContent = fmt(trip.totalDistance, 1);
    }
    if ($(`${prefix}TripEquation`)) {
      $(`${prefix}TripEquation`).textContent = trip.method === "leg"
        ? `${fmt(trip.oneWayDistance, 1)} × ${trip.directionMultiplier} × ${trip.tripCount} = ${fmt(trip.totalDistance, 1)} กม.`
        : `${fmt(trip.totalDistance, 1)} กม. รวมทั้งทริป`;
    }
    if ($(`${prefix}RoundTripText`)) {
      $(`${prefix}RoundTripText`).textContent = trip.roundTrip
        ? "ไป–กลับ"
        : "เที่ยวเดียว";
    }

    if (prefix === "mountain") updateMountainElevation(trip);
    return trip;
  }

  function renderDriverProfile() {
    const profile = driverProfile();
    if ($("driverProfileLabel")) $("driverProfileLabel").textContent = profile.label;
    if ($("driverProfileDetail")) $("driverProfileDetail").textContent = profile.detail;
    if ($("driverProfileFactor")) $("driverProfileFactor").textContent = `${fmt(profile.factor, 3)}×`;
    if ($("driverProfileCard")) {
      $("driverProfileCard").dataset.available = profile.available ? "true" : "false";
    }
  }

  function renderActualRecords() {
    const root = $("actualRecordsList");
    if (!root) return;

    const records = actualRecords()
      .sort((a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || ""))
      .slice(0, 8);

    root.textContent = "";

    if (!records.length) {
      const empty = document.createElement("div");
      empty.className = "actual-record-empty";
      empty.textContent = "ยังไม่มีบันทึกเติมจริง";
      root.append(empty);
      return;
    }

    records.forEach(record => {
      const row = document.createElement("article");
      row.className = "actual-record-row";

      const copy = document.createElement("div");
      const title = document.createElement("strong");
      const detail = document.createElement("span");
      title.textContent = `${fmt(record.total, 2)} บาท • ${fmt(record.totalDistance, 1)} กม.`;
      detail.textContent = `${fmt(record.perKm, 2)} บาท/กม. • ${
        record.calibration
          ? `เรียนรู้ ${fmt(record.calibration.factor, 3)}×`
          : "ไม่ใช้เรียนรู้"
      } • ${new Date(record.createdAt).toLocaleString("th-TH")}`;
      copy.append(title, detail);

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "mini-btn danger";
      remove.dataset.deleteActualRecord = String(record.id);
      remove.textContent = "ลบ";

      row.append(copy, remove);
      root.append(row);
    });
  }

  function setMode(next, syncVehicle = true) {
    if (!energyData[next]) return;

    const oldPrimary = primarySourceKind(mode);
    mode = next;
    const data = energyData[mode];

    document.querySelectorAll("#powerTabs button").forEach(button => {
      const active = button.dataset.mode === mode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });

    if ($("energyType")) {
      const previousType = normalizeEnergyType($("energyType").value);
      $("energyType").innerHTML = data.types
        .map(type => `<option value="${type}">${type}</option>`)
        .join("");
      if (data.types.includes(previousType)) {
        $("energyType").value = previousType;
      }
    }

    if ($("efficiency")) $("efficiency").value = data.eff;
    if ($("energyPrice")) $("energyPrice").value = data.price;
    if ($("effUnit")) $("effUnit").textContent = data.effUnit;
    if ($("priceUnit")) $("priceUnit").textContent = data.priceUnit;

    const nextPrimary = primarySourceKind(mode);
    const source1 = $("actualSource1Type");
    if (source1 && (!source1.value || source1.value === oldPrimary || source1.value === previousPrimaryKind)) {
      source1.value = nextPrimary;
    }
    previousPrimaryKind = nextPrimary;
    updateSourceUnits();

    if (syncVehicle && (mode === "hybrid" || mode === "ev")) {
      setVehicle(mode, false);
    }

    renderDriverProfile();
    window.dispatchEvent(new CustomEvent("drivecost:modechange", { detail: { mode } }));
    calculate();
  }

  function setVehicle(next, syncPower = true) {
    if (!vehicleData[next]) return;

    const previous = vehicle;
    vehicle = next;
    const data = vehicleData[vehicle];

    document.querySelectorAll("#vehicleSelector .vehicle-option").forEach(button => {
      const active = button.dataset.vehicle === vehicle;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });

    if ($("vehicleLabel")) $("vehicleLabel").textContent = data.label;
    if ($("mountainVehicleMass")) $("mountainVehicleMass").value = data.mass;

    const image = $("vehicleImage");
    const stage = $("vehicleStage");
    const sameVehicle = stage?.dataset.vehicle === vehicle;
    const sameImage = image?.getAttribute("src") === data.image;

    if (image && (!sameVehicle || !sameImage)) {
      image.classList.add("switching");
      const finish = () => image.classList.remove("switching");
      if (image.getAttribute("src") !== data.image) image.src = data.image;
      if (stage) stage.dataset.vehicle = vehicle;
      if (image.complete) finish();
      else {
        image.addEventListener("load", finish, { once: true });
        image.addEventListener("error", finish, { once: true });
      }
      setTimeout(finish, 450);
    }

    if (previous !== vehicle) {
      window.dispatchEvent(new CustomEvent("drivecost:vehiclechange", { detail: { vehicle } }));
    }

    if (syncPower) {
      if (mode !== data.defaultMode) setMode(data.defaultMode, false);
      else if ($("efficiency")) $("efficiency").value = data.eff;
    }

    renderDriverProfile();
    renderActualRecords();
    calculate();
  }

  function modeCopy(next) {
    if (next === "estimate") {
      return {
        help: "วางแผนก่อนเดินทางจากระยะทาง อัตราสิ้นเปลือง ราคา และพฤติกรรมผู้ขับที่แสดงแยก",
        button: "▣  คำนวณก่อนเดินทาง"
      };
    }
    if (next === "mountain") {
      return {
        help: "คำนวณทางราบ พลังงานขึ้นเขา การคืนพลังงานขาลง น้ำหนัก รถติด แอร์ และผิวทางแยกทุกรายการ",
        button: "▣  คำนวณเส้นทางภูเขา"
      };
    }
    return {
      help: "ใช้เลขไมล์และยอดเติมจริง ระบบรวมค่าน้ำมัน แก๊ส และไฟฟ้าโดยไม่หารผู้โดยสาร",
      button: "▣  คำนวณจากยอดเติมจริง"
    };
  }

  function setCalculationMode(next) {
    if (!["actual", "estimate", "mountain"].includes(next)) next = "actual";
    calculationMode = next;

    document.querySelectorAll("[data-calculation-mode]").forEach(button => {
      const active = button.dataset.calculationMode === calculationMode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });

    document.querySelectorAll("[data-mode-panel]").forEach(panel => {
      const active = panel.dataset.modePanel === calculationMode;
      panel.classList.toggle("active", active);
      panel.hidden = !active;
    });

    const copy = modeCopy(calculationMode);
    if ($("calculationModeHelp")) $("calculationModeHelp").textContent = copy.help;
    if ($("calcBtn")) $("calcBtn").textContent = copy.button;

    window.dispatchEvent(new CustomEvent("drivecost:calculationmodechange", {
      detail: { calculationMode }
    }));

    calculate();
  }

  function gatherActual() {
    return {
      mode,
      baselineEfficiency: number("efficiency", energyData[mode].eff),
      useDirectDistance: $("actualUseDirectDistance")?.checked,
      odometerStart: number("actualOdometerStart"),
      odometerEnd: number("actualOdometerEnd"),
      directDistance: number("actualDirectDistance"),
      fillMethod: $("actualFillMethod")?.value || "full_to_full",
      sources: [1, 2, 3].map(index => ({
        kind: $(`actualSource${index}Type`)?.value || "",
        quantity: number(`actualSource${index}Quantity`),
        cost: number(`actualSource${index}Cost`)
      }))
    };
  }

  function gatherEstimate() {
    const trip = updateTripPlanner("estimate");
    return {
      mode,
      trip,
      distance: trip.totalDistance,
      efficiency: number("efficiency", energyData[mode].eff),
      price: number("energyPrice", energyData[mode].price),
      driverFactor: driverFactor("estimateDriverPreset", "estimateDriverCustom")
    };
  }

  function gatherMountain() {
    const trip = updateTripPlanner("mountain");
    const elevation = updateMountainElevation(trip);

    return {
      mode,
      trip,
      distance: trip.totalDistance,
      elevation,
      efficiency: number("efficiency", energyData[mode].eff),
      price: number("energyPrice", energyData[mode].price),
      vehicleMass: number("mountainVehicleMass", vehicleData[vehicle].mass),
      payloadMass: number("mountainPayload"),
      ascent: elevation.ascent,
      descent: elevation.descent,
      maxGrade: number("mountainMaxGrade"),
      driverFactor: driverFactor("mountainDriverPreset", "mountainDriverCustom"),
      trafficPct: number("mountainTraffic"),
      acPct: number("mountainAc"),
      roadPct: number("mountainRoad")
    };
  }

  function setKpi(index, label, value, unit) {
    if ($(`resultKpi${index}Label`)) $(`resultKpi${index}Label`).textContent = label;
    const valueId = ["energyUsed", "totalDistance", "costPerKm", "energyPriceUsed"][index - 1];
    if ($(valueId)) {
      $(valueId).innerHTML = `${value} <em>${unit}</em>`;
    }
  }

  function renderBreakdown(result) {
    const root = $("resultBreakdown");
    if (!root) return;
    root.textContent = "";

    const rows = Array.isArray(result.breakdown) ? result.breakdown : [];
    if (!rows.length) {
      const empty = document.createElement("div");
      empty.className = "result-breakdown-empty";
      empty.textContent = "ยังไม่มีรายการสำหรับคำนวณ";
      root.append(empty);
      return;
    }

    rows.forEach(item => {
      const row = document.createElement("div");
      row.className = `result-breakdown-row ${item.amount < 0 ? "negative" : ""}`;

      const copy = document.createElement("div");
      const title = document.createElement("strong");
      const detail = document.createElement("span");
      title.textContent = item.label;
      detail.textContent = item.detail || "";
      copy.append(title, detail);

      const amount = document.createElement("b");
      const sign = item.amount > 0 ? "+" : "";
      amount.textContent = `${sign}${fmt(item.amount, 2)} บาท`;

      row.append(copy, amount);
      root.append(row);
    });

    const totalRow = document.createElement("div");
    totalRow.className = "result-breakdown-row total";
    const totalLabel = document.createElement("strong");
    const totalAmount = document.createElement("b");
    totalLabel.textContent = "รวมสุทธิ";
    totalAmount.textContent = `${fmt(result.total, 2)} บาท`;
    totalRow.append(totalLabel, totalAmount);
    root.append(totalRow);
  }

  function renderWarnings(result) {
    const root = $("resultWarnings");
    if (!root) return;

    const warnings = Array.isArray(result.warnings) ? result.warnings : [];
    root.textContent = "";
    root.hidden = warnings.length === 0;

    warnings.forEach(message => {
      const row = document.createElement("div");
      row.textContent = `! ${message}`;
      root.append(row);
    });
  }

  function renderResult(result) {
    lastResult = result;
    const isActual = result.calculationMode === "actual";
    const isMountain = result.calculationMode === "mountain";

    if ($("resultMetricLabel")) {
      $("resultMetricLabel").textContent = isActual
        ? "ค่าเชื้อเพลิงจากยอดเติมจริง"
        : isMountain
          ? "ค่าเชื้อเพลิงเส้นทางภูเขา"
          : "ค่าน้ำมันประมาณก่อนเดินทาง";
    }

    if ($("totalCost")) {
      $("totalCost").innerHTML = `${fmt(result.total, 2)} <span>บาท</span>`;
    }

    if ($("totalDistanceInput")) $("totalDistanceInput").value = result.totalDistance;
    if ($("distance")) $("distance").value = result.totalDistance;
    if ($("passengers")) $("passengers").value = "1";
    if ($("factorValue")) {
      const factor = result.driverFactor || 1;
      $("factorValue").textContent = `${fmt(factor, 3)}×`;
    }

    if (isActual) {
      setKpi(1, "ระยะทางจริง", fmt(result.totalDistance, 1), "กม.");
      setKpi(2, "ยอดเติมรวม", fmt(result.total, 2), "บาท");
      setKpi(3, "ต้นทุนจริงต่อกิโลเมตร", fmt(result.perKm, 2), "บาท/กม.");
      setKpi(4, "คุณภาพข้อมูล", result.confidence?.level === "high" ? "สูง" : result.confidence?.level === "medium" ? "กลาง" : "ประกอบ", result.confidence?.level === "high" ? "เต็มถัง" : "ตรวจวิธีเติม");

      if ($("resultBreakdownTitle")) $("resultBreakdownTitle").textContent = "ยอดเติมจริงที่นำมารวม";
      if ($("trustBarLabel")) $("trustBarLabel").textContent = "คุณภาพข้อมูลจริง";
      if ($("currentPriceSource")) $("currentPriceSource").textContent = result.confidence?.label || "ข้อมูลจริง";
      if ($("currentPriceUpdated")) $("currentPriceUpdated").textContent = result.confidence?.detail || "ใช้ข้อมูลที่กรอก";
      if ($("inlineLiveRefreshButton")) $("inlineLiveRefreshButton").hidden = true;
      if ($("resultInsightTitle")) $("resultInsightTitle").textContent = "ยอดจริงไม่ถูกปรับด้วยตัวคูณ";
      if ($("insightText")) {
        $("insightText").textContent = result.calibration
          ? `ครั้งนี้วัดได้ ${fmt(result.calibration.observedPer100, 2)} ${result.calibration.unit} เทียบค่ามาตรฐาน ${fmt(result.calibration.baselinePer100, 2)} ${result.calibration.unit} และสามารถใช้เรียนรู้ผู้ขับได้`
          : "ระบบรวมยอดที่จ่ายจริงโดยตรง ไม่หารผู้โดยสาร และไม่เปลี่ยนยอดด้วยสภาพรถหรือเส้นทาง";
      }
    } else if (isMountain) {
      setKpi(1, "พลังงานรวม", fmt(result.energyUse, 2), result.energyUnit);
      setKpi(2, "ระยะทาง", fmt(result.totalDistance, 1), "กม.");
      setKpi(3, "พลังงานขาขึ้น", fmt(result.ascentMechanicalKwh, 2), "kWh ที่ล้อ");
      setKpi(4, "ต้นทุนต่อกิโลเมตร", fmt(result.perKm, 2), "บาท/กม.");

      if ($("resultBreakdownTitle")) $("resultBreakdownTitle").textContent = "แยกผลกระทบเส้นทางภูเขา";
      if ($("trustBarLabel")) $("trustBarLabel").textContent = "แหล่งราคาพลังงาน";
      if ($("inlineLiveRefreshButton")) $("inlineLiveRefreshButton").hidden = false;
      if ($("resultInsightTitle")) $("resultInsightTitle").textContent = "ความสูงสะสมสำคัญกว่าความสูงปลายทาง";
      if ($("insightText")) {
        $("insightText").textContent = result.recoveryUse > 0
          ? `ขาขึ้นเพิ่มพลังงาน ${fmt(result.climbUse, 2)} ${result.energyUnit} และคาดว่าจะคืนจากขาลง ${fmt(result.recoveryUse, 2)} ${result.energyUnit}`
          : "รถเครื่องยนต์ทั่วไปไม่หักพลังงานขาลงคืนเป็นน้ำมัน ผลลัพธ์จึงเป็นค่าประมาณแบบระมัดระวัง";
      }
    } else {
      setKpi(1, "พลังงานที่คาดว่าจะใช้", fmt(result.energyUse, 2), result.energyUnit);
      setKpi(2, "ระยะทาง", fmt(result.totalDistance, 1), "กม.");
      setKpi(3, "ต้นทุนต่อกิโลเมตร", fmt(result.perKm, 2), "บาท/กม.");
      setKpi(4, "ปัจจัยผู้ขับ", fmt(result.driverFactor, 3), "เท่า");

      if ($("resultBreakdownTitle")) $("resultBreakdownTitle").textContent = "ค่ามาตรฐานและพฤติกรรมผู้ขับ";
      if ($("trustBarLabel")) $("trustBarLabel").textContent = "แหล่งราคาพลังงาน";
      if ($("inlineLiveRefreshButton")) $("inlineLiveRefreshButton").hidden = false;
      if ($("resultInsightTitle")) $("resultInsightTitle").textContent = "ใช้ข้อมูลจริงของคุณได้";
      if ($("insightText")) {
        const profile = driverProfile();
        $("insightText").textContent = profile.available
          ? `ประมาณการนี้ใช้ปัจจัย ${fmt(result.driverFactor, 3)}× จากข้อมูลเติมจริง ${profile.sampleCount} ครั้ง หรือเปลี่ยนเป็นค่ามาตรฐานได้ทุกเมื่อ`
          : "ยังไม่มีข้อมูลเติมเต็มถัง ระบบใช้ค่ามาตรฐาน 1.000× จนกว่าจะมีข้อมูลจริง";
      }
    }

    renderBreakdown(result);
    renderWarnings(result);
    updateActualDistance();

    if ($("dateStamp")) {
      $("dateStamp").textContent = `คำนวณล่าสุด ${new Date().toLocaleString("th-TH", {
        dateStyle: "medium",
        timeStyle: "short"
      })}`;
    }

    window.dispatchEvent(new CustomEvent("drivecost:calculated", { detail: result }));
  }

  function calculate() {
    let result;

    if (calculationMode === "actual") {
      result = engine.calculateActual(gatherActual());
    } else if (calculationMode === "mountain") {
      result = engine.calculateMountain(gatherMountain());
    } else {
      result = engine.calculateEstimate(gatherEstimate());
    }

    result = {
      ...result,
      mode,
      vehicle,
      energyType: $("energyType")?.value || energyData[mode].types[0],
      energyCost: result.total,
      toll: 0,
      parking: 0,
      other: 0,
      multiplier: result.driverFactor || 1
    };

    renderResult(result);
    return result;
  }

  function snapshot() {
    const data = {
      calculationMode,
      mode,
      vehicle,
      energyType: $("energyType")?.value || "",
      estimateDistanceMethod: selectedTripMethod("estimate"),
      mountainDistanceMethod: selectedTripMethod("mountain")
    };

    inputIds.forEach(id => {
      const element = $(id);
      if (!element) return;
      data[id] = element.type === "checkbox" ? element.checked : element.value;
    });

    return data;
  }

  function applyData(data) {
    if (!data || typeof data !== "object") return;

    setMode(data.mode || "fuel", false);
    setVehicle(data.vehicle || "sedan", false);
    setCalculationMode(data.calculationMode || "estimate");

    if (data.energyType !== undefined && $("energyType")) {
      const normalizedType = normalizeEnergyType(data.energyType);
      if ([...$("energyType").options].some(option => option.value === normalizedType)) {
        $("energyType").value = normalizedType;
      }
    }

    setTripMethod(
      "estimate",
      data.estimateDistanceMethod ||
        (data.calculationMode === undefined ? "direct" : "leg")
    );
    setTripMethod(
      "mountain",
      data.mountainDistanceMethod || "leg"
    );

    inputIds.forEach(id => {
      const element = $(id);
      if (!element || data[id] === undefined) return;
      if (element.type === "checkbox") element.checked = Boolean(data[id]);
      else element.value = data[id];
    });

    if (data.calculationMode === undefined) {
      const legacyDistance = Math.max(0, Number(data.totalDistanceInput || data.distance) || 0);
      if ($("estimateDistance")) $("estimateDistance").value = legacyDistance || 300;
      setTripMethod("estimate", "direct");
      setCalculationMode("estimate");
    }

    updateSourceUnits();
    updateActualDistance();
    updateTripPlanner("estimate");
    updateTripPlanner("mountain");
    renderDriverProfile();
    calculate();
  }

  function saveActualRecord() {
    setCalculationMode("actual");
    const result = calculate();

    if (result.totalDistance <= 0 || result.total <= 0) {
      toast("กรุณาใส่ระยะทางและยอดเติมจริงก่อนบันทึก");
      return;
    }

    const records = actualRecords();
    const record = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      vehicle,
      mode,
      energyType: $("energyType")?.value || "",
      note: $("actualRecordNote")?.value.trim().slice(0, 160) || "",
      fillMethod: $("actualFillMethod")?.value || "full_to_full",
      total: result.total,
      totalDistance: result.totalDistance,
      perKm: result.perKm,
      sources: result.sources,
      calibration: result.calibration,
      confidence: result.confidence
    };

    records.unshift(record);
    if (!storageSet(ACTUAL_RECORDS_KEY, JSON.stringify(records.slice(0, 100)))) {
      toast("บันทึกในเครื่องไม่สำเร็จ กรุณาตรวจพื้นที่จัดเก็บของเบราว์เซอร์");
      return;
    }
    renderActualRecords();
    renderDriverProfile();

    toast(result.calibration
      ? "บันทึกแล้ว และอัปเดตโปรไฟล์ผู้ขับ"
      : "บันทึกยอดจริงแล้ว แต่ยังไม่ใช้เรียนรู้");
  }

  function deleteActualRecord(id) {
    const records = actualRecords().filter(record => String(record.id) !== String(id));
    storageSet(ACTUAL_RECORDS_KEY, JSON.stringify(records));
    renderActualRecords();
    renderDriverProfile();
    calculate();
    toast("ลบบันทึกเติมจริงแล้ว");
  }

  function clearActualRecords() {
    if (!confirm("ล้างบันทึกเติมจริงทั้งหมดของบัญชีนี้หรือไม่?")) return;
    storageSet(ACTUAL_RECORDS_KEY, "[]");
    renderActualRecords();
    renderDriverProfile();
    calculate();
    toast("ล้างบันทึกเติมจริงแล้ว");
  }

  function exportCSV() {
    const result = calculate();
    const rows = [
      ["DriveCost v3.1.2", result.calculationLabel],
      ["รายการ", "ค่า"],
      ...result.inputs,
      ...result.breakdown.map(item => [
        item.label,
        `${item.amount.toFixed(2)} บาท${item.detail ? ` • ${item.detail}` : ""}`
      ]),
      ["รวมสุทธิ", `${result.total.toFixed(2)} บาท`],
      ["ต้นทุนต่อกิโลเมตร", `${result.perKm.toFixed(3)} บาท/กม.`]
    ];

    const csv = "\uFEFF" + rows
      .map(row => row.map(value => `"${String(value ?? "").replaceAll('"', '""')}"`).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `drivecost-${result.calculationMode}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    toast("ส่งออก CSV แล้ว");
  }

  async function shareResult() {
    const result = calculate();
    const text = `DriveCost ${result.calculationLabel}: ${fmt(result.total, 2)} บาท • ${fmt(result.totalDistance, 1)} กม. • ${fmt(result.perKm, 2)} บาท/กม.`;

    if (navigator.share) {
      await navigator.share({ title: "DriveCost", text }).catch(() => {});
    } else if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      toast("คัดลอกผลลัพธ์แล้ว");
    }
  }

  document.querySelectorAll("[data-calculation-mode]").forEach(button => {
    button.addEventListener("click", () => setCalculationMode(button.dataset.calculationMode));
  });

  document.querySelectorAll("#vehicleSelector .vehicle-option").forEach(button => {
    button.addEventListener("click", () => setVehicle(button.dataset.vehicle));
  });

  document.querySelectorAll("#powerTabs button").forEach(button => {
    button.addEventListener("click", () => setMode(button.dataset.mode));
  });

  ["estimate", "mountain"].forEach(prefix => {
    document.querySelectorAll(
      `input[name="${prefix}DistanceMethod"]`
    ).forEach(radio => {
      radio.addEventListener("change", () => {
        updateTripPlanner(prefix);
        calculate();
      });
    });
  });

  inputIds.forEach(id => {
    const element = $(id);
    if (!element) return;
    ["input", "change"].forEach(eventName => {
      element.addEventListener(eventName, () => {
        if (id === "actualUseDirectDistance") updateActualDistance();
        if (/actualSource[123]Type/.test(id)) updateSourceUnits();
        if (id.startsWith("estimate")) updateTripPlanner("estimate");
        if (id.startsWith("mountain")) updateTripPlanner("mountain");
        calculate();
      });
    });
  });

  $("calcBtn")?.addEventListener("click", () => {
    calculate();
    toast("คำนวณข้อมูลล่าสุดแล้ว");
  });

  $("saveActualRecordBtn")?.addEventListener("click", saveActualRecord);
  $("clearActualRecordsBtn")?.addEventListener("click", clearActualRecords);

  $("actualRecordsList")?.addEventListener("click", event => {
    const button = event.target.closest("[data-delete-actual-record]");
    if (button) deleteActualRecord(button.dataset.deleteActualRecord);
  });

  $("csvBtn")?.addEventListener("click", exportCSV);
  $("shareBtn")?.addEventListener("click", shareResult);

  window.addEventListener("drivecost:cloudapplied", () => {
    renderActualRecords();
    renderDriverProfile();
    calculate();
  });

  window.DriveCostCore = {
    get mode() { return mode; },
    get vehicle() { return vehicle; },
    get calculationMode() { return calculationMode; },
    get lastResult() { return lastResult; },
    vehicleData,
    energyData,
    normalizeEnergyType,
    ids: inputIds,
    setMode,
    setVehicle,
    setCalculationMode,
    updateTripPlanner,
    tripPlan,
    calculate,
    snapshot,
    applyData,
    refreshPersonalization() {
      renderActualRecords();
      renderDriverProfile();
      calculate();
    },
    getDriverProfile: driverProfile,
    getActualRecords: actualRecords,
    actualRecordsKey: ACTUAL_RECORDS_KEY
  };

  setMode("fuel", false);
  setVehicle("sedan", false);
  setCalculationMode("actual");
  updateSourceUnits();
  updateActualDistance();
  updateTripPlanner("estimate");
  updateTripPlanner("mountain");
  renderActualRecords();
  renderDriverProfile();
  calculate();
})();
