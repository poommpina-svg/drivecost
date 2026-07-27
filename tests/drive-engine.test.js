"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  calculateActual,
  calculateEstimate,
  calculateMountain,
  buildDriverProfile
} = require("../drive-engine");

test("actual fill keeps the paid amount unchanged", () => {
  const result = calculateActual({
    mode: "fuel",
    baselineEfficiency: 10,
    odometerStart: 50000,
    odometerEnd: 50300,
    fillMethod: "full_to_full",
    sources: [
      { kind: "fuel", quantity: 34.711, cost: 1100 }
    ]
  });

  assert.equal(result.total, 1100);
  assert.equal(result.totalDistance, 300);
  assert.ok(Math.abs(result.perKm - 3.666667) < 0.000001);
  assert.equal(result.perPerson, 1100);
  assert.equal(result.calculationMode, "actual");
});

test("actual fill adds petrol and gas costs without combining their units", () => {
  const result = calculateActual({
    useDirectDistance: true,
    directDistance: 600,
    fillMethod: "receipt_total",
    mode: "fuel",
    baselineEfficiency: 12,
    sources: [
      { kind: "fuel", quantity: 20, cost: 700 },
      { kind: "lpg", quantity: 25, cost: 400 }
    ]
  });

  assert.equal(result.total, 1100);
  assert.equal(result.perKm, 1.833333);
  assert.equal(result.sources.length, 2);
  assert.equal(result.calibration, null);
});

test("estimate never divides by passengers", () => {
  const result = calculateEstimate({
    mode: "fuel",
    distance: 300,
    efficiency: 10,
    price: 31.69,
    driverFactor: 1
  });

  assert.equal(result.total, 950.7);
  assert.equal(result.perPerson, 950.7);
  assert.equal(result.energyUse, 30);
});

test("learned driver factor is explicit in estimate", () => {
  const result = calculateEstimate({
    mode: "fuel",
    distance: 300,
    efficiency: 10,
    price: 31.69,
    driverFactor: 1.15
  });

  assert.ok(Math.abs(result.total - 1093.305) < 0.000001);
  assert.ok(result.breakdown.some(item => item.label === "ผลจากพฤติกรรมผู้ขับ"));
});

test("mountain ascent costs more than an equivalent flat estimate", () => {
  const flat = calculateEstimate({
    mode: "fuel",
    distance: 300,
    efficiency: 10,
    price: 31.69,
    driverFactor: 1
  });

  const mountain = calculateMountain({
    mode: "fuel",
    distance: 300,
    efficiency: 10,
    price: 31.69,
    vehicleMass: 1750,
    payloadMass: 150,
    ascent: 1200,
    descent: 1200,
    maxGrade: 10,
    driverFactor: 1,
    trafficPct: 0,
    acPct: 0,
    roadPct: 0
  });

  assert.ok(mountain.total > flat.total);
  assert.equal(mountain.recoveryUse, 0);
  assert.ok(mountain.climbUse > 0);
});

test("EV mountain model credits regenerative braking", () => {
  const result = calculateMountain({
    mode: "ev",
    distance: 100,
    efficiency: 18,
    price: 4.2,
    vehicleMass: 1850,
    payloadMass: 100,
    ascent: 1000,
    descent: 1000,
    maxGrade: 9,
    driverFactor: 1,
    trafficPct: 0,
    acPct: 0,
    roadPct: 0
  });

  assert.ok(result.climbUse > 0);
  assert.ok(result.recoveryUse > 0);
  assert.ok(result.breakdown.some(item => item.amount < 0));
});

test("driver profile uses median of valid full-tank calibrations", () => {
  const records = [
    { vehicle: "suv", mode: "fuel", createdAt: "2026-07-01", calibration: { factor: 1.2 } },
    { vehicle: "suv", mode: "fuel", createdAt: "2026-07-02", calibration: { factor: 1.0 } },
    { vehicle: "suv", mode: "fuel", createdAt: "2026-07-03", calibration: { factor: 1.1 } },
    { vehicle: "sedan", mode: "fuel", createdAt: "2026-07-04", calibration: { factor: 0.8 } }
  ];

  const profile = buildDriverProfile(records, "suv", "fuel");
  assert.equal(profile.available, true);
  assert.equal(profile.factor, 1.1);
  assert.equal(profile.sampleCount, 3);
});
