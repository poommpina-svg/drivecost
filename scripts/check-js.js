"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const root = path.resolve(__dirname, "..");
const files = [
  "server.js",
  "server/config.js",
  "server/security.js",
  "server/fuel-prices.js",
  "server/supabase-admin.js",
  "storage-scope.js",
  "production-bootstrap.js",
  "core-app.js",
  "supabase-config.js",
  "account-sync.js",
  "app-v2.js",
  "accessibility-status.js",
  "provenance-calculation.js",
  "live-prices.js",
  "ui-guard.js",
  "admin.js",
  "service-worker.js",
  "scripts/preflight.js",
  "scripts/smoke-test.js",
  "scripts/production-audit.js"
];

let failed = false;

for (const relative of files) {
  const absolute = path.join(root, relative);

  if (!fs.existsSync(absolute)) {
    console.error(`MISSING ${relative}`);
    failed = true;
    continue;
  }

  const result = spawnSync(process.execPath, ["--check", absolute], {
    encoding: "utf8"
  });

  if (result.status !== 0) {
    console.error(`SYNTAX ERROR ${relative}`);
    console.error(result.stderr || result.stdout);
    failed = true;
  } else {
    console.log(`OK ${relative}`);
  }
}

process.exit(failed ? 1 : 0);
