"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const core = fs.readFileSync(path.join(root, "core-app.js"), "utf8");
const live = fs.readFileSync(path.join(root, "live-prices.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

test("mobile navigation exposes the energy-price page", () => {
  assert.match(
    html,
    /class="mobile-nav"[\s\S]*data-page="energy"[\s\S]*<span>ราคา<\/span>/
  );
});

test("fuel catalog contains exact 91 and E20/E85 names", () => {
  assert.match(core, /"แก๊สโซฮอล์ E20"/);
  assert.match(core, /"แก๊สโซฮอล์ 91"/);
  assert.match(core, /"เบนซิน 91"/);
  assert.match(core, /"แก๊สโซฮอล์ E85"/);
});

test("live-price product targets map to the exact fuel type", () => {
  assert.match(
    live,
    /gasoline91:\s*\{\s*mode:\s*"fuel",\s*type:\s*"เบนซิน 91"\s*\}/
  );
  assert.match(
    live,
    /gasohol91:\s*\{\s*mode:\s*"fuel",\s*type:\s*"แก๊สโซฮอล์ 91"\s*\}/
  );
  assert.match(
    live,
    /dieselB20:\s*\{\s*mode:\s*"diesel",\s*type:\s*"ดีเซล B20"\s*\}/
  );
});

test("known incorrect product mappings are absent", () => {
  assert.doesNotMatch(
    live,
    /gasoline91:\s*\{\s*mode:\s*"fuel",\s*type:\s*"เบนซิน 95"\s*\}/
  );
  assert.doesNotMatch(
    live,
    /gasohol91:\s*\{\s*mode:\s*"fuel",\s*type:\s*"แก๊สโซฮอล์ 95"\s*\}/
  );
  assert.doesNotMatch(
    live,
    /dieselB20:\s*\{\s*mode:\s*"diesel",\s*type:\s*"ดีเซล B10"\s*\}/
  );
});


test("live-price buttons expose deterministic selected, busy, and idle states", () => {
  assert.match(live, /data-state="\$\{active \? "selected" : "idle"\}"/);
  assert.match(live, /active\s*\?\s*"✓ กำลังใช้อยู่"/);
  assert.match(live, /busy\s*\?\s*"กำลังเปลี่ยน…"/);
  assert.match(live, /function activateProductById\(/);
});

test("manual selection is protected from delayed mode-change restoration", () => {
  assert.match(
    live,
    /window\.addEventListener\("drivecost:modechange",\s*\(\)\s*=>\s*\{\s*if \(priceSelectionBusy\) return;/
  );
});
