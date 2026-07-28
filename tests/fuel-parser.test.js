"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  parseSoapResponse,
  parseBangchakResponse,
  mergeOfficialPrices,
  isoFromThaiEffectiveRemark,
  normalizeProductId
} = require("../server/fuel-prices");

test("normalizes supported OR product names", () => {
  assert.equal(normalizeProductId("Gasohol 95"), "gasohol95");
  assert.equal(normalizeProductId("Diesel B20"), "dieselB20");
  assert.equal(normalizeProductId("Premium Diesel"), "premiumDiesel");
  assert.equal(normalizeProductId("NGV"), "ngv");
});

test("parses a SOAP response and validates prices", () => {
  const fixture = fs.readFileSync(
    path.join(__dirname, "fixtures", "or-price-response.xml"),
    "utf8"
  );

  const result = parseSoapResponse(fixture);

  assert.ok(Array.isArray(result.prices));
  assert.equal(result.prices.length, 4);

  const gasohol95 = result.prices.find(
    item => item.id === "gasohol95"
  );
  assert.equal(gasohol95.price, 36.69);

  const dieselB20 = result.prices.find(
    item => item.id === "dieselB20"
  );
  assert.equal(dieselB20.price, 31.69);

  assert.ok(result.effectiveAt);
});

test("rejects invalid or unsupported XML", () => {
  assert.throws(
    () => parseSoapResponse("<xml><empty /></xml>"),
    /CurrentOilPriceResult|GetOilPriceResult/
  );
});


test("parses Bangchak E85 from the official JSON shape", () => {
  const fixture = JSON.parse(fs.readFileSync(
    path.join(__dirname, "fixtures", "bangchak-price-response.json"),
    "utf8"
  ));

  const result = parseBangchakResponse(fixture);
  const e85 = result.prices.find(item => item.id === "gasoholE85");

  assert.ok(e85);
  assert.equal(e85.price, 27.63);
  assert.equal(e85.sourceLabel, "บางจาก");
  assert.match(e85.provider, /Bangchak/);
  assert.equal(e85.effectiveAt, "2026-07-22T22:00:00.000Z");
});

test("Thai effective-date remark converts Buddhist year correctly", () => {
  assert.equal(
    isoFromThaiEffectiveRemark("ราคามีผล ณ วันที่ 23 ก.ค. 69 เวลา 05.00 น."),
    "2026-07-22T22:00:00.000Z"
  );
});

test("merged official prices always prefer Bangchak for E85", () => {
  const merged = mergeOfficialPrices(
    {
      prices: [{
        id: "gasoholE85",
        label: "old",
        product: "old",
        price: 99,
        unit: "THB/L",
        provider: "OR",
        effectiveAt: "2026-07-20T00:00:00.000Z"
      }]
    },
    {
      prices: [{
        id: "gasoholE85",
        label: "แก๊สโซฮอล์ E85",
        product: "แก๊สโซฮอล์ E85 S EVO",
        price: 27.63,
        unit: "THB/L",
        provider: "Bangchak Official Oil Price API",
        sourceLabel: "บางจาก",
        effectiveAt: "2026-07-22T22:00:00.000Z"
      }]
    }
  );

  const e85 = merged.prices.find(item => item.id === "gasoholE85");
  assert.equal(e85.price, 27.63);
  assert.equal(e85.sourceLabel, "บางจาก");
});
