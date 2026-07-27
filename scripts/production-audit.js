"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const reportPath = path.join(root, "reports", "PRODUCTION_AUDIT_REPORT.md");

const commands = [
  ["JavaScript syntax", "npm", ["run", "check"]],
  ["Unit tests", "npm", ["test"]],
  ["HTTP smoke test", "npm", ["run", "smoke"]],
  ["Production preflight", "npm", ["run", "preflight"]]
];

const results = [];

for (const [name, command, args] of commands) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32"
  });

  results.push({
    name,
    ok: result.status === 0,
    output: `${result.stdout || ""}\n${result.stderr || ""}`.trim()
  });
}

const passed = results.filter(result => result.ok).length;
const failed = results.length - passed;

const report = [
  "# DriveCost v3.1.0 — Production Audit Report",
  "",
  `วันที่ตรวจ: ${new Date().toISOString()}`,
  "",
  `ผลรวม: ${passed}/${results.length} ชุดทดสอบผ่าน`,
  "",
  ...results.flatMap(result => [
    `## ${result.ok ? "PASS" : "FAIL"} — ${result.name}`,
    "",
    "```text",
    result.output.slice(0, 12000),
    "```",
    ""
  ]),
  "## ขอบเขตที่ตรวจ",
  "",
  "- JavaScript syntax ทุกไฟล์ที่ใช้จริง",
  "- Unit tests สำหรับ security, fuel parser และ admin authorization",
  "- HTTP smoke test: health, CSP, runtime config, admin noindex, static allowlist",
  "- Preflight: assets, HTML IDs, Supabase RLS, Render Blueprint, secret scanning",
  "",
  failed
    ? "สถานะ: **ยังไม่ควร Deploy จนกว่า FAIL จะเป็นศูนย์**"
    : "สถานะ: **ผ่านการตรวจอัตโนมัติและพร้อมเข้าสู่ขั้นตอน Deploy checklist**",
  ""
].join("\n");

fs.writeFileSync(reportPath, report);

console.log(report);
process.exit(failed ? 1 : 0);
