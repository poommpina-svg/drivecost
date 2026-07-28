"use strict";

const APP_VERSION = "3.1.5";

function text(name, fallback = "") {
  return String(process.env[name] ?? fallback).trim();
}

function boolean(name, fallback = false) {
  const value = text(name);
  if (!value) return fallback;
  return /^(1|true|yes|on)$/i.test(value);
}

function integer(name, fallback, minimum, maximum) {
  const parsed = Number.parseInt(text(name), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function list(name) {
  return new Set(
    text(name)
      .split(",")
      .map(value => value.trim().toLowerCase())
      .filter(Boolean)
  );
}

function normalizedUrl(value) {
  const raw = String(value || "").replace(/\/+$/, "");
  if (!raw) return "";
  try {
    return new URL(raw).toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

const supabaseSecret =
  text("SUPABASE_SECRET_KEY") ||
  text("SUPABASE_SERVICE_ROLE_KEY");

const config = Object.freeze({
  version: APP_VERSION,
  environment: text("NODE_ENV", "development"),
  host: text("HOST", process.env.RENDER ? "0.0.0.0" : "127.0.0.1"),
  port: integer("PORT", process.env.RENDER ? 10000 : 8080, 1, 65535),

  appOrigin: normalizedUrl(
    text("APP_ORIGIN") ||
    text("RENDER_EXTERNAL_URL")
  ),

  supabaseUrl: normalizedUrl(text("SUPABASE_URL")),
  supabasePublishableKey:
    text("SUPABASE_PUBLISHABLE_KEY") ||
    text("SUPABASE_ANON_KEY"),
  supabaseSecretKey: supabaseSecret,

  adminEnabled: boolean("ADMIN_DASHBOARD_ENABLED", true),
  adminEmails: list("ADMIN_EMAILS"),
  adminUserIds: list("ADMIN_USER_IDS"),
  ipHashSalt: text("IP_HASH_SALT"),

  requestTimeoutMs: integer("REQUEST_TIMEOUT_MS", 10000, 1000, 30000),
  maxJsonBodyBytes: integer("MAX_JSON_BODY_BYTES", 65536, 1024, 1048576),
  adminCacheMs: integer("ADMIN_CACHE_MS", 30000, 0, 300000),

  fuelUpstream:
    normalizedUrl(text("FUEL_PRICE_UPSTREAM")) ||
    "https://orapiweb.pttor.com/oilservice/OilPrice.asmx",
  bangchakFuelUpstream:
    normalizedUrl(text("BANGCHAK_FUEL_PRICE_UPSTREAM")) ||
    "https://oil-price.bangchak.co.th/ApiOilPrice2/th",
  fuelCacheTtlMs: integer("FUEL_CACHE_TTL_MS", 15 * 60 * 1000, 60000, 86400000),
  fuelStaleTtlMs: integer("FUEL_STALE_TTL_MS", 24 * 60 * 60 * 1000, 60000, 604800000),

  render: Object.freeze({
    serviceName: text("RENDER_SERVICE_NAME"),
    serviceId: text("RENDER_SERVICE_ID"),
    instanceId: text("RENDER_INSTANCE_ID"),
    commit: text("RENDER_GIT_COMMIT"),
    branch: text("RENDER_GIT_BRANCH"),
    repo: text("RENDER_GIT_REPO_SLUG"),
    externalUrl: normalizedUrl(text("RENDER_EXTERNAL_URL"))
  })
});

function validateConfiguration({ strict = false } = {}) {
  const checks = [];

  function add(id, ok, severity, message) {
    checks.push({ id, ok: Boolean(ok), severity, message });
  }

  add(
    "supabase_url",
    /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(config.supabaseUrl),
    "critical",
    config.supabaseUrl
      ? "SUPABASE_URL ต้องเป็น URL ของโปรเจกต์ Supabase"
      : "ยังไม่ได้ตั้ง SUPABASE_URL"
  );

  add(
    "publishable_key",
    config.supabasePublishableKey.length >= 30 &&
      !/sb_secret_|service[_-]?role/i.test(config.supabasePublishableKey),
    "critical",
    config.supabasePublishableKey
      ? "Publishable key ต้องไม่ใช่ Secret/Service Role"
      : "ยังไม่ได้ตั้ง SUPABASE_PUBLISHABLE_KEY"
  );

  add(
    "secret_key",
    config.supabaseSecretKey.length >= 30 &&
      !/^sb_publishable_/i.test(config.supabaseSecretKey),
    "critical",
    config.supabaseSecretKey
      ? "Secret key พร้อมใช้งานฝั่งเซิร์ฟเวอร์"
      : "ยังไม่ได้ตั้ง SUPABASE_SECRET_KEY"
  );

  add(
    "admin_allowlist",
    config.adminEmails.size > 0 || config.adminUserIds.size > 0,
    "warning",
    "ควรตั้ง ADMIN_EMAILS หรือ ADMIN_USER_IDS อย่างน้อยหนึ่งรายการ"
  );

  add(
    "ip_hash_salt",
    config.ipHashSalt.length >= 32,
    "warning",
    "ควรตั้ง IP_HASH_SALT แบบสุ่มอย่างน้อย 32 ตัวอักษร"
  );

  add(
    "production_origin",
    config.environment !== "production" ||
      /^https:\/\//i.test(config.appOrigin || config.render.externalUrl),
    "warning",
    "Production ควรใช้ APP_ORIGIN แบบ HTTPS"
  );

  const failedCritical = checks.filter(
    check => !check.ok && check.severity === "critical"
  );

  return {
    ok: strict ? failedCritical.length === 0 : true,
    checks,
    failedCritical
  };
}

module.exports = {
  APP_VERSION,
  config,
  validateConfiguration
};
