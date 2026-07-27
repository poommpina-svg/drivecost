"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  parseSoapResponse,
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
