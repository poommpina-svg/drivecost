(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DriveCostEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const G = 9.80665;
  const KWH_PER_JOULE = 1 / 3_600_000;

  const ENERGY = Object.freeze({
    fuel:   { unit: "ลิตร", shortUnit: "L", densityKwh: 8.9, driveEfficiency: 0.24, regenEfficiency: 0 },
    diesel: { unit: "ลิตร", shortUnit: "L", densityKwh: 9.8, driveEfficiency: 0.29, regenEfficiency: 0 },
    lpg:    { unit: "ลิตร", shortUnit: "L", densityKwh: 6.6, driveEfficiency: 0.23, regenEfficiency: 0 },
    ngv:    { unit: "กก.", shortUnit: "kg", densityKwh: 13.1, driveEfficiency: 0.26, regenEfficiency: 0 },
    hybrid: { unit: "ลิตร", shortUnit: "L", densityKwh: 8.9, driveEfficiency: 0.34, regenEfficiency: 0.18 },
    ev:     { unit: "kWh", shortUnit: "kWh", densityKwh: 1, driveEfficiency: 0.88, regenEfficiency: 0.65 }
  });

  const SOURCE_LABELS = Object.freeze({
    fuel: "น้ำมันเบนซิน / แก๊สโซฮอล์",
    diesel: "ดีเซล",
    lpg: "LPG",
    ngv: "NGV",
    ev: "ไฟฟ้า"
  });

  function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function nonNegative(value) {
    return Math.max(0, finite(value));
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, finite(value)));
  }

  function round(value, digits = 6) {
    const factor = 10 ** digits;
    return Math.round((finite(value) + Number.EPSILON) * factor) / factor;
  }

  function energyKindForMode(mode) {
    if (mode === "hybrid") return "fuel";
    return ENERGY[mode] ? mode : "fuel";
  }

  function energyUseForDistance(mode, distance, efficiency) {
    const safeDistance = nonNegative(distance);
    const safeEfficiency = Math.max(0.0001, finite(efficiency, 1));
    return mode === "ev"
      ? safeDistance * safeEfficiency / 100
      : safeDistance / safeEfficiency;
  }


  function resolveTripDistance(input = {}) {
    const method = input.method === "leg" ? "leg" : "direct";
    const directDistance = nonNegative(input.directDistance);
    const oneWayDistance = nonNegative(input.oneWayDistance);
    const roundTrip = Boolean(input.roundTrip);
    const tripCount = Math.max(1, Math.min(999, Math.floor(finite(input.tripCount, 1))));
    const directionMultiplier = roundTrip ? 2 : 1;
    const multiplier = method === "leg"
      ? directionMultiplier * tripCount
      : 1;
    const totalDistance = method === "leg"
      ? oneWayDistance * multiplier
      : directDistance;

    return {
      method,
      directDistance: round(directDistance, 6),
      oneWayDistance: round(oneWayDistance, 6),
      roundTrip,
      tripCount,
      directionMultiplier,
      multiplier,
      totalDistance: round(totalDistance, 6),
      label: method === "leg"
        ? "ระยะทางต่อเที่ยว"
        : "ระยะทางรวมโดยตรง",
      expression: method === "leg"
        ? `${round(oneWayDistance, 2)} × ${directionMultiplier} × ${tripCount}`
        : `${round(directDistance, 2)}`,
      detail: method === "leg"
        ? `${round(oneWayDistance, 2)} กม. ต่อเที่ยว • ${roundTrip ? "ไป–กลับ" : "เที่ยวเดียว"} • ${tripCount} ชุดการเดินทาง`
        : "ผู้ใช้กรอกระยะทางรวมทั้งทริปโดยตรง"
    };
  }

  function resolveElevation(input = {}, trip = resolveTripDistance()) {
    const scope = input.scope === "per_leg" ? "per_leg" : "whole_trip";
    const ascentInput = nonNegative(input.ascent);
    const descentInput = nonNegative(input.descent);
    const multiplier = scope === "per_leg" && trip.method === "leg"
      ? trip.multiplier
      : 1;

    return {
      scope,
      multiplier,
      ascentInput: round(ascentInput, 6),
      descentInput: round(descentInput, 6),
      ascent: round(ascentInput * multiplier, 6),
      descent: round(descentInput * multiplier, 6),
      label: scope === "per_leg"
        ? "ความสูงสะสมต่อเที่ยว"
        : "ความสูงสะสมรวมทั้งทริป",
      detail: scope === "per_leg" && trip.method === "leg"
        ? `คูณตามเส้นทาง ${trip.multiplier} เท่า`
        : "ใช้ค่าที่กรอกโดยตรง"
    };
  }

  function confidence(method) {
    if (method === "full_to_full") {
      return {
        level: "high",
        label: "ความน่าเชื่อถือสูง",
        detail: "เติมเต็มถังก่อนและหลังช่วงเลขไมล์"
      };
    }
    if (method === "receipt_total") {
      return {
        level: "medium",
        label: "ความน่าเชื่อถือปานกลาง",
        detail: "ใช้ยอดจากใบเสร็จรวม แต่ระดับเชื้อเพลิงต้นทางและปลายทางอาจต่างกัน"
      };
    }
    return {
      level: "low",
      label: "ใช้เป็นข้อมูลประกอบ",
      detail: "การเติมบางส่วนอาจไม่ใช่พลังงานที่ใช้หมดในช่วงระยะทางนี้"
    };
  }

  function calculateActual(input = {}) {
    const useDirect = Boolean(input.useDirectDistance);
    const odometerStart = nonNegative(input.odometerStart);
    const odometerEnd = nonNegative(input.odometerEnd);
    const directDistance = nonNegative(input.directDistance);
    const distance = useDirect
      ? directDistance
      : Math.max(0, odometerEnd - odometerStart);

    const sources = (Array.isArray(input.sources) ? input.sources : [])
      .map((source, index) => {
        const kind = ENERGY[source?.kind] ? source.kind : "";
        const quantity = nonNegative(source?.quantity);
        const cost = nonNegative(source?.cost);
        const meta = ENERGY[kind];
        return {
          index,
          kind,
          label: SOURCE_LABELS[kind] || "ไม่ใช้",
          quantity,
          cost,
          unit: meta?.unit || "",
          unitPrice: quantity > 0 ? cost / quantity : null,
          consumptionPer100: distance > 0 && quantity > 0
            ? quantity / distance * 100
            : null,
          efficiency: distance > 0 && quantity > 0 && kind !== "ev"
            ? distance / quantity
            : null
        };
      })
      .filter(source => source.kind && (source.cost > 0 || source.quantity > 0));

    const total = sources.reduce((sum, source) => sum + source.cost, 0);
    const perKm = distance > 0 ? total / distance : 0;
    const totalQuantitySources = sources.filter(source => source.quantity > 0);

    const warnings = [];
    if (!useDirect && odometerEnd <= odometerStart) {
      warnings.push("เลขไมล์สิ้นสุดต้องมากกว่าเลขไมล์เริ่มต้น");
    }
    if (distance <= 0) warnings.push("กรุณาระบุระยะทางจริงมากกว่า 0 กม.");
    if (total <= 0) warnings.push("กรุณาระบุยอดที่จ่ายจริงอย่างน้อยหนึ่งรายการ");
    if (sources.some(source => source.cost > 0 && source.quantity <= 0)) {
      warnings.push("ใส่ยอดเงินได้ แต่ต้องใส่ปริมาณด้วยหากต้องการคำนวณอัตราสิ้นเปลืองจริง");
    }

    const method = input.fillMethod || "full_to_full";
    const confidenceInfo = confidence(method);
    const baselineEfficiency = Math.max(0.0001, finite(input.baselineEfficiency, 1));
    const primaryKind = energyKindForMode(input.mode);
    let calibration = null;

    if (
      method === "full_to_full" &&
      distance > 0 &&
      totalQuantitySources.length === 1 &&
      totalQuantitySources[0].kind === primaryKind
    ) {
      const source = totalQuantitySources[0];
      const observedPer100 = source.quantity / distance * 100;
      const baselinePer100 = input.mode === "ev"
        ? baselineEfficiency
        : 100 / baselineEfficiency;
      const rawFactor = observedPer100 / Math.max(0.0001, baselinePer100);

      if (rawFactor >= 0.5 && rawFactor <= 2) {
        calibration = {
          kind: source.kind,
          factor: round(rawFactor, 6),
          observedPer100: round(observedPer100, 6),
          baselinePer100: round(baselinePer100, 6),
          unit: input.mode === "ev" ? "kWh/100 กม." : `${source.unit}/100 กม.`
        };
      } else {
        warnings.push("ข้อมูลอัตราสิ้นเปลืองต่างจากค่ามาตรฐานมาก จึงไม่ใช้เรียนรู้พฤติกรรมอัตโนมัติ");
      }
    }

    const breakdown = sources.map(source => ({
      label: source.label,
      amount: source.cost,
      detail: source.quantity > 0
        ? `${round(source.quantity, 3)} ${source.unit}${source.unitPrice !== null ? ` • ${round(source.unitPrice, 2)} บาท/${source.unit}` : ""}`
        : "ยอดค่าใช้จ่ายจริง"
    }));

    const sourceCostExpression = sources.length
      ? sources.map(source => round(source.cost, 2)).join(" + ")
      : "0";

    const steps = [
      {
        title: "หาระยะทางจริง",
        expression: useDirect
          ? `${round(directDistance, 2)} กม.`
          : `${round(odometerEnd, 1)} − ${round(odometerStart, 1)}`,
        result: `${round(distance, 2)} กม.`,
        note: useDirect ? "ใช้ระยะทางรวมที่กรอกโดยตรง" : "เลขไมล์สิ้นสุดลบเลขไมล์เริ่มต้น"
      },
      {
        title: "รวมยอดเชื้อเพลิงทุกชนิด",
        expression: sourceCostExpression,
        result: `${round(total, 2)} บาท`,
        note: "รวมยอดน้ำมัน แก๊ส และไฟฟ้าที่จ่ายจริง โดยไม่รวมปริมาณต่างหน่วยเข้าด้วยกัน",
        final: true
      },
      {
        title: "คำนวณต้นทุนจริงต่อกิโลเมตร",
        expression: distance > 0 ? `${round(total, 2)} ÷ ${round(distance, 2)}` : "รอระยะทาง",
        result: `${round(perKm, 3)} บาท/กม.`,
        note: "ไม่มีการหารตามจำนวนผู้โดยสาร"
      }
    ];

    return {
      valid: warnings.length === 0 || (distance > 0 && total > 0),
      calculationMode: "actual",
      calculationLabel: "เติมจริง",
      totalDistance: round(distance, 6),
      total: round(total, 6),
      perKm: round(perKm, 6),
      perPerson: round(total, 6),
      energyUse: 0,
      energyUnit: sources.length === 1 ? sources[0].unit : "หลายพลังงาน",
      sources,
      sourceCount: sources.length,
      breakdown,
      steps,
      warnings,
      confidence: confidenceInfo,
      calibration,
      inputs: [
        ["วิธีวัดระยะทาง", useDirect ? "ระยะทางรวมโดยตรง" : "เลขไมล์ต้นทางและปลายทาง"],
        ["ระยะทางจริง", `${round(distance, 2)} กม.`],
        ["วิธีเติม", confidenceInfo.detail],
        ["จำนวนแหล่งพลังงาน", `${sources.length} รายการ`],
        ["ยอดเชื้อเพลิงรวม", `${round(total, 2)} บาท`],
        ["การหารผู้โดยสาร", "ไม่ใช้"]
      ]
    };
  }

  function calculateEstimate(input = {}) {
    const mode = ENERGY[input.mode] ? input.mode : "fuel";
    const trip = resolveTripDistance(
      input.trip || {
        method: "direct",
        directDistance: input.distance
      }
    );
    const distance = trip.totalDistance;
    const efficiency = Math.max(0.0001, finite(input.efficiency, 1));
    const price = nonNegative(input.price);
    const driverFactor = clamp(input.driverFactor || 1, 0.65, 1.7);

    const baseUse = energyUseForDistance(mode, distance, efficiency);
    const driverAdjustmentUse = baseUse * (driverFactor - 1);
    const totalUse = Math.max(0, baseUse + driverAdjustmentUse);
    const baseCost = baseUse * price;
    const driverAdjustmentCost = driverAdjustmentUse * price;
    const total = totalUse * price;
    const perKm = distance > 0 ? total / distance : 0;
    const meta = ENERGY[mode];

    const warnings = [];
    if (distance <= 0) warnings.push("กรุณาระบุระยะทางมากกว่า 0 กม.");
    if (price <= 0) warnings.push("กรุณาระบุราคาพลังงานมากกว่า 0");
    if (efficiency <= 0) warnings.push("กรุณาระบุอัตราสิ้นเปลืองมากกว่า 0");

    const useExpression = mode === "ev"
      ? `${round(distance, 2)} × (${round(efficiency, 2)} ÷ 100)`
      : `${round(distance, 2)} ÷ ${round(efficiency, 2)}`;

    return {
      valid: distance > 0 && price > 0 && efficiency > 0,
      calculationMode: "estimate",
      calculationLabel: "ประมาณก่อนเดินทาง",
      totalDistance: round(distance, 6),
      total: round(total, 6),
      perKm: round(perKm, 6),
      perPerson: round(total, 6),
      energyUse: round(totalUse, 6),
      energyUnit: meta.unit,
      driverFactor: round(driverFactor, 6),
      breakdown: [
        { label: "ค่าพลังงานตามค่ามาตรฐาน", amount: round(baseCost, 6), detail: `${round(baseUse, 3)} ${meta.unit}` },
        {
          label: "ผลจากพฤติกรรมผู้ขับ",
          amount: round(driverAdjustmentCost, 6),
          detail: `${driverFactor >= 1 ? "+" : ""}${round((driverFactor - 1) * 100, 1)}% • แสดงแยก ไม่ซ่อนในสูตร`
        }
      ],
      trip,
      steps: [
        {
          title: "คำนวณระยะทางรวม",
          expression: trip.expression,
          result: `${round(distance, 2)} กม.`,
          note: trip.detail
        },
        {
          title: "คำนวณพลังงานตามระยะทาง",
          expression: useExpression,
          result: `${round(baseUse, 3)} ${meta.unit}`,
          note: mode === "ev" ? "ระยะทาง × kWh/100 กม." : "ระยะทาง ÷ กม./หน่วย"
        },
        {
          title: "ปรับตามพฤติกรรมผู้ขับ",
          expression: `${round(baseUse, 3)} × ${round(driverFactor, 3)}`,
          result: `${round(totalUse, 3)} ${meta.unit}`,
          note: `ปัจจัยผู้ขับ ${round(driverFactor, 3)}×`
        },
        {
          title: "คำนวณค่าน้ำมันสุทธิ",
          expression: `${round(totalUse, 3)} × ${round(price, 2)}`,
          result: `${round(total, 2)} บาท`,
          note: "ไม่บวกค่าทางด่วน ค่าจอด หรือหารผู้โดยสาร",
          final: true
        }
      ],
      warnings,
      inputs: [
        ["วิธีใส่ระยะทาง", trip.label],
        ["รายละเอียดระยะทาง", trip.detail],
        ["ระยะทางรวม", `${round(distance, 2)} กม.`],
        ["อัตราสิ้นเปลือง", mode === "ev" ? `${round(efficiency, 2)} kWh/100 กม.` : `${round(efficiency, 2)} กม./${meta.unit}`],
        ["ราคาพลังงาน", `${round(price, 2)} บาท/${meta.unit}`],
        ["ปัจจัยผู้ขับ", `${round(driverFactor, 3)}×`],
        ["การหารผู้โดยสาร", "ไม่ใช้"]
      ]
    };
  }

  function calculateMountain(input = {}) {
    const mode = ENERGY[input.mode] ? input.mode : "fuel";
    const meta = ENERGY[mode];
    const trip = resolveTripDistance(
      input.trip || {
        method: "direct",
        directDistance: input.distance
      }
    );
    const elevation = resolveElevation(
      input.elevation || {
        scope: "whole_trip",
        ascent: input.ascent,
        descent: input.descent
      },
      trip
    );
    const distance = trip.totalDistance;
    const efficiency = Math.max(0.0001, finite(input.efficiency, 1));
    const price = nonNegative(input.price);
    const vehicleMass = clamp(input.vehicleMass, 300, 10_000);
    const payloadMass = clamp(input.payloadMass, 0, 5_000);
    const totalMass = vehicleMass + payloadMass;
    const ascent = elevation.ascent;
    const descent = elevation.descent;
    const maxGrade = nonNegative(input.maxGrade);
    const driverFactor = clamp(input.driverFactor || 1, 0.65, 1.7);
    const trafficPct = clamp(input.trafficPct, 0, 0.5);
    const acPct = clamp(input.acPct, 0, 0.3);
    const roadPct = clamp(input.roadPct, 0, 0.3);

    const baseUse = energyUseForDistance(mode, distance, efficiency);
    const driverUse = baseUse * (driverFactor - 1);
    const trafficUse = baseUse * trafficPct;
    const acUse = baseUse * acPct;
    const roadUse = baseUse * roadPct;

    const ascentMechanicalKwh = totalMass * G * ascent * KWH_PER_JOULE;
    const descentMechanicalKwh = totalMass * G * descent * KWH_PER_JOULE;

    let climbUse;
    let recoveryUse;

    if (mode === "ev") {
      climbUse = ascentMechanicalKwh / meta.driveEfficiency;
      recoveryUse = descentMechanicalKwh * meta.regenEfficiency;
    } else {
      climbUse = ascentMechanicalKwh / (meta.densityKwh * meta.driveEfficiency);
      recoveryUse = meta.regenEfficiency > 0
        ? descentMechanicalKwh * meta.regenEfficiency / (meta.densityKwh * meta.driveEfficiency)
        : 0;
    }

    const subtotalUse = baseUse + driverUse + trafficUse + acUse + roadUse + climbUse - recoveryUse;
    const minimumUse = baseUse * 0.35;
    const totalUse = Math.max(0, baseUse > 0 ? Math.max(minimumUse, subtotalUse) : subtotalUse);
    const total = totalUse * price;
    const perKm = distance > 0 ? total / distance : 0;

    const warnings = [];
    if (distance <= 0) warnings.push("กรุณาระบุระยะทางมากกว่า 0 กม.");
    if (ascent <= 0) warnings.push("ยังไม่ได้ใส่ความสูงสะสมขาขึ้น ผลลัพธ์จะใกล้ทางราบ");
    if (maxGrade >= 15) warnings.push("เส้นทางมีความชันสูงมาก ควรเผื่อพลังงานและตรวจระบบเบรก");
    else if (maxGrade >= 10) warnings.push("เส้นทางค่อนข้างชัน ควรเผื่อพลังงานสำรอง");
    if (mode !== "ev" && mode !== "hybrid" && descent > 0) {
      warnings.push("รถเครื่องยนต์ไม่หักพลังงานขาลงคืน เพราะไม่สามารถเปลี่ยนกลับเป็นเชื้อเพลิงได้");
    }

    const costs = {
      base: baseUse * price,
      driver: driverUse * price,
      traffic: trafficUse * price,
      ac: acUse * price,
      road: roadUse * price,
      climb: climbUse * price,
      recovery: -recoveryUse * price
    };

    const breakdown = [
      { label: "พลังงานทางราบ", amount: round(costs.base, 6), detail: `${round(baseUse, 3)} ${meta.unit}` },
      { label: "พฤติกรรมผู้ขับ", amount: round(costs.driver, 6), detail: `${driverFactor >= 1 ? "+" : ""}${round((driverFactor - 1) * 100, 1)}%` },
      { label: "การจราจร", amount: round(costs.traffic, 6), detail: `+${round(trafficPct * 100, 1)}%` },
      { label: "เครื่องปรับอากาศ", amount: round(costs.ac, 6), detail: `+${round(acPct * 100, 1)}%` },
      { label: "สภาพผิวทาง", amount: round(costs.road, 6), detail: `+${round(roadPct * 100, 1)}%` },
      { label: "พลังงานขึ้นเขา", amount: round(costs.climb, 6), detail: `${round(ascentMechanicalKwh, 3)} kWh ที่ล้อ • สูงสะสม ${round(ascent, 0)} ม.` }
    ];

    if (recoveryUse > 0) {
      breakdown.push({
        label: "พลังงานคืนจากทางลง",
        amount: round(costs.recovery, 6),
        detail: `−${round(recoveryUse, 3)} ${meta.unit} • ประสิทธิภาพคืนพลังงาน ${round(meta.regenEfficiency * 100, 0)}%`
      });
    }

    const useExpression = mode === "ev"
      ? `${round(distance, 2)} × (${round(efficiency, 2)} ÷ 100)`
      : `${round(distance, 2)} ÷ ${round(efficiency, 2)}`;

    return {
      valid: distance > 0 && price > 0 && efficiency > 0,
      calculationMode: "mountain",
      calculationLabel: "เส้นทางภูเขา",
      totalDistance: round(distance, 6),
      total: round(total, 6),
      perKm: round(perKm, 6),
      perPerson: round(total, 6),
      energyUse: round(totalUse, 6),
      energyUnit: meta.unit,
      driverFactor: round(driverFactor, 6),
      totalMass: round(totalMass, 3),
      ascentMechanicalKwh: round(ascentMechanicalKwh, 6),
      descentMechanicalKwh: round(descentMechanicalKwh, 6),
      climbUse: round(climbUse, 6),
      recoveryUse: round(recoveryUse, 6),
      maxGrade: round(maxGrade, 3),
      trip,
      elevation,
      breakdown,
      steps: [
        {
          title: "คำนวณระยะทางรวม",
          expression: trip.expression,
          result: `${round(distance, 2)} กม.`,
          note: trip.detail
        },
        {
          title: "จัดเตรียมความสูงสะสม",
          expression: elevation.scope === "per_leg"
            ? `${round(elevation.ascentInput, 0)} × ${elevation.multiplier}`
            : `${round(elevation.ascentInput, 0)}`,
          result: `ขึ้น ${round(ascent, 0)} ม. • ลง ${round(descent, 0)} ม.`,
          note: `${elevation.label} • ${elevation.detail}`
        },
        {
          title: "คำนวณพลังงานทางราบ",
          expression: useExpression,
          result: `${round(baseUse, 3)} ${meta.unit}`,
          note: "ใช้ระยะทางและอัตราสิ้นเปลืองของรถ"
        },
        {
          title: "ปรับปัจจัยการใช้งานที่เปิดเผย",
          expression: `${round(baseUse, 3)} + ผู้ขับ ${round(driverUse, 3)} + รถติด ${round(trafficUse, 3)} + แอร์ ${round(acUse, 3)} + ผิวทาง ${round(roadUse, 3)}`,
          result: `${round(baseUse + driverUse + trafficUse + acUse + roadUse, 3)} ${meta.unit}`,
          note: "ทุกปัจจัยแสดงเป็นรายการ ไม่ใช้ตัวคูณลับ"
        },
        {
          title: "คำนวณพลังงานศักย์ขาขึ้น",
          expression: `${round(totalMass, 0)} × 9.80665 × ${round(ascent, 0)} ÷ 3,600,000`,
          result: `${round(ascentMechanicalKwh, 3)} kWh ที่ล้อ`,
          note: `แปลงเป็น ${meta.unit} ด้วยประสิทธิภาพระบบขับเคลื่อน ${round(meta.driveEfficiency * 100, 0)}%`
        },
        {
          title: "หักพลังงานคืนจากขาลง",
          expression: recoveryUse > 0 ? `${round(recoveryUse, 3)} ${meta.unit}` : "0",
          result: recoveryUse > 0 ? `−${round(recoveryUse, 3)} ${meta.unit}` : "ไม่หักคืน",
          note: recoveryUse > 0 ? `สมมติประสิทธิภาพคืนพลังงาน ${round(meta.regenEfficiency * 100, 0)}%` : "รถเครื่องยนต์ทั่วไปไม่สามารถคืนเป็นเชื้อเพลิง"
        },
        {
          title: "คำนวณต้นทุนสุทธิ",
          expression: `${round(totalUse, 3)} × ${round(price, 2)}`,
          result: `${round(total, 2)} บาท`,
          note: "ไม่หารผู้โดยสารและไม่รวมค่าใช้จ่ายที่ไม่ใช่พลังงาน",
          final: true
        }
      ],
      warnings,
      inputs: [
        ["วิธีใส่ระยะทาง", trip.label],
        ["รายละเอียดระยะทาง", trip.detail],
        ["ระยะทางรวม", `${round(distance, 2)} กม.`],
        ["วิธีใส่ความสูง", elevation.label],
        ["ความสูงสะสมขึ้น", `${round(ascent, 0)} ม.`],
        ["ความสูงสะสมลง", `${round(descent, 0)} ม.`],
        ["น้ำหนักรวม", `${round(totalMass, 0)} กก.`],
        ["ความชันสูงสุด", `${round(maxGrade, 1)}%`],
        ["ปัจจัยผู้ขับ", `${round(driverFactor, 3)}×`],
        ["รถติด", `+${round(trafficPct * 100, 1)}%`],
        ["แอร์", `+${round(acPct * 100, 1)}%`],
        ["ผิวทาง", `+${round(roadPct * 100, 1)}%`]
      ]
    };
  }

  function median(values) {
    const sorted = values
      .map(Number)
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function buildDriverProfile(records, vehicle, mode) {
    const valid = (Array.isArray(records) ? records : [])
      .filter(record =>
        record?.vehicle === vehicle &&
        record?.mode === mode &&
        record?.calibration?.factor >= 0.5 &&
        record?.calibration?.factor <= 2
      )
      .sort((a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || ""))
      .slice(0, 10);

    const rawMedian = median(valid.map(record => record.calibration.factor));
    if (rawMedian === null) {
      return {
        available: false,
        factor: 1,
        sampleCount: 0,
        label: "ยังไม่มีข้อมูลเติมเต็มถัง",
        detail: "บันทึกการเติมจริงแบบเต็มถังอย่างน้อย 1 ครั้งเพื่อเริ่มเรียนรู้"
      };
    }

    const factor = clamp(rawMedian, 0.75, 1.5);
    const delta = (factor - 1) * 100;
    const style = delta <= -5
      ? "ประหยัดกว่าค่ามาตรฐาน"
      : delta >= 5
        ? "ใช้พลังงานมากกว่าค่ามาตรฐาน"
        : "ใกล้ค่ามาตรฐาน";

    return {
      available: true,
      factor: round(factor, 6),
      rawFactor: round(rawMedian, 6),
      sampleCount: valid.length,
      label: style,
      detail: `${delta >= 0 ? "+" : ""}${round(delta, 1)}% จากข้อมูลจริง ${valid.length} ครั้ง`,
      lastUpdated: valid[0]?.createdAt || null
    };
  }

  return Object.freeze({
    ENERGY,
    SOURCE_LABELS,
    calculateActual,
    calculateEstimate,
    calculateMountain,
    buildDriverProfile,
    resolveTripDistance,
    resolveElevation,
    energyUseForDistance,
    energyKindForMode,
    round
  });
});
