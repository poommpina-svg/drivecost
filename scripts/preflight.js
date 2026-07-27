"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const errors = [];
const warnings = [];
const passes = [];

function pass(message) {
  passes.push(message);
}

function fail(message) {
  errors.push(message);
}

function warn(message) {
  warnings.push(message);
}

function read(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

function exists(relative) {
  return fs.existsSync(path.join(root, relative));
}

const requiredFiles = [
  "index.html",
  "admin.html",
  "server.js",
  "render.yaml",
  ".node-version",
  ".env.example",
  "package.json",
  "package-lock.json",
  "service-worker.js",
  "app.bundle.css",
  "admin.css",
  "admin.js",
  "supabase/production.sql",
  "DEPLOY-RENDER.md",
  "ADMIN-GUIDE.md",
  "PRODUCTION-CHECKLIST.md"
];

for (const file of requiredFiles) {
  if (exists(file)) pass(`มีไฟล์ ${file}`);
  else fail(`ขาดไฟล์ ${file}`);
}

const index = read("index.html");
const admin = read("admin.html");
const server = read("server.js");
const productionSql = read("supabase/production.sql");
const renderYaml = read("render.yaml");

if (Buffer.byteLength(index) < 150_000) {
  pass("index.html มีขนาดเหมาะสมสำหรับ Production");
} else {
  fail("index.html ใหญ่เกิน 150 KB");
}

if (!/data:image\/webp;base64/i.test(index)) {
  pass("ไม่มีภาพรถ Base64 ฝังใน HTML");
} else {
  fail("ยังมีภาพรถ Base64 ฝังใน HTML");
}

if (!/\son[a-z]+\s*=/i.test(index)) {
  pass("ไม่มี inline event handler ในหน้าหลัก");
} else {
  fail("พบ inline event handler ในหน้าหลัก");
}

if (!/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/i.test(admin)) {
  pass("หน้าแอดมินไม่มี inline JavaScript");
} else {
  fail("หน้าแอดมินมี inline JavaScript");
}

const idMatches = [...index.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
const duplicateIds = [...new Set(
  idMatches.filter((id, indexValue) => idMatches.indexOf(id) !== indexValue)
)];
if (!duplicateIds.length) {
  pass("ไม่พบ HTML id ซ้ำในหน้าหลัก");
} else {
  fail(`พบ HTML id ซ้ำ: ${duplicateIds.join(", ")}`);
}

const localReferences = [
  ...index.matchAll(/\b(?:src|href)="(\/[^"#?]+)(?:\?[^"]*)?"/g),
  ...admin.matchAll(/\b(?:src|href)="(\/[^"#?]+)(?:\?[^"]*)?"/g)
].map(match => match[1]);

for (const reference of [...new Set(localReferences)]) {
  if (
    reference === "/" ||
    reference === "/runtime-config.js" ||
    reference === "/admin"
  ) continue;

  const diskPath = reference === "/"
    ? "index.html"
    : reference.slice(1);

  if (!exists(diskPath)) {
    fail(`ไฟล์ที่อ้างอิงไม่มีอยู่: ${reference}`);
  }
}

if (
  index.indexOf("/runtime-config.js") <
  index.indexOf("/supabase-config.js")
) {
  pass("runtime-config โหลดก่อน Supabase fallback");
} else {
  fail("ลำดับ runtime-config และ Supabase fallback ไม่ถูกต้อง");
}

const sensitivePatterns = [
  /sb_secret_[A-Za-z0-9_-]{20,}/g,
  /service_role["']?\s*[:=]\s*["']eyJ[A-Za-z0-9._-]+/g,
  /SUPABASE_SECRET_KEY\s*=\s*[^\s#][^\r\n]+/g
];

const scanFiles = [
  "index.html",
  "admin.html",
  "admin.js",
  "server.js",
  "server/config.js",
  "server/supabase-admin.js",
  "render.yaml"
];

for (const file of scanFiles) {
  const text = read(file);
  for (const pattern of sensitivePatterns) {
    const matches = text.match(pattern) || [];
    const realMatches = matches.filter(value => !value.includes("..."));
    if (realMatches.length) {
      fail(`พบค่าที่อาจเป็น Secret ใน ${file}`);
    }
  }
}
if (!errors.some(error => error.includes("Secret"))) {
  pass("ไม่พบ Supabase Secret ฝังในไฟล์สาธารณะ");
}

const requiredHeaders = [
  "Content-Security-Policy",
  "Strict-Transport-Security",
  "X-Frame-Options",
  "X-Content-Type-Options",
  "Permissions-Policy"
];
const securityModule = read("server/security.js");
for (const header of requiredHeaders) {
  if (securityModule.includes(header)) pass(`มี Security header ${header}`);
  else fail(`ขาด Security header ${header}`);
}

const sqlRequirements = [
  "alter table public.profiles enable row level security",
  "alter table public.user_sync_state enable row level security",
  "alter table public.app_admins enable row level security",
  "alter table public.admin_audit_log enable row level security",
  "auth.uid()",
  "admin_system_integrity",
  "revoke all on public.app_admins from anon, authenticated",
  "revoke all on public.admin_audit_log from anon, authenticated"
];
for (const statement of sqlRequirements) {
  if (productionSql.toLowerCase().includes(statement.toLowerCase())) {
    pass(`SQL มี ${statement}`);
  } else {
    fail(`SQL ขาด ${statement}`);
  }
}

const renderRequirements = [
  "type: web",
  "runtime: node",
  "healthCheckPath: /healthz",
  "buildCommand: npm ci && npm run verify",
  "startCommand: npm start",
  "SUPABASE_SECRET_KEY",
  "sync: false"
];
for (const item of renderRequirements) {
  if (renderYaml.includes(item)) pass(`render.yaml มี ${item}`);
  else fail(`render.yaml ขาด ${item}`);
}

if (/plan:\s*free\b/.test(renderYaml)) {
  warn("ใช้ Render Free จะ sleep หลังไม่มี traffic เหมาะกับทดสอบ ไม่เหมาะกับผู้ใช้จริง");
} else {
  pass("Blueprint ไม่ใช้ Render Free");
}

if (server.includes('PUBLIC_FILES') && !server.includes('"/server.js"')) {
  pass("Static server ใช้ allowlist และไม่เปิดเผย server.js");
} else {
  fail("Static server อาจเปิดเผยไฟล์หลังบ้าน");
}

if (server.includes("/healthz") && server.includes("/readyz")) {
  pass("มี liveness และ readiness endpoint");
} else {
  fail("ขาด health endpoint");
}

console.log(`\nPASS ${passes.length}`);
passes.forEach(message => console.log(`  ✓ ${message}`));

if (warnings.length) {
  console.log(`\nWARN ${warnings.length}`);
  warnings.forEach(message => console.log(`  ! ${message}`));
}

if (errors.length) {
  console.error(`\nFAIL ${errors.length}`);
  errors.forEach(message => console.error(`  ✗ ${message}`));
  process.exit(1);
}

console.log("\nPreflight ผ่านทั้งหมด");
