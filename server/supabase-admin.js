"use strict";

const { config, validateConfiguration } = require("./config");

let overviewCache = null;

function apiKeyHeaders(key) {
  const headers = {
    apikey: key,
    Accept: "application/json"
  };

  // Legacy service_role is a JWT. New sb_secret_ keys must stay in apikey.
  if (String(key).split(".").length === 3) {
    headers.Authorization = `Bearer ${key}`;
  }

  return headers;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = config.requestTimeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error("Supabase request timed out");
      timeoutError.code = "SUPABASE_TIMEOUT";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function parseResponse(response) {
  const contentType = String(response.headers.get("content-type") || "");
  const body = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : await response.text().catch(() => "");

  if (!response.ok) {
    const message =
      body?.message ||
      body?.msg ||
      body?.error_description ||
      body?.error ||
      (typeof body === "string" && body) ||
      `Supabase HTTP ${response.status}`;

    const error = new Error(String(message));
    error.statusCode = response.status;
    error.payload = body;
    throw error;
  }

  return {
    body,
    headers: response.headers,
    status: response.status
  };
}

function requireSupabasePublicConfig() {
  if (!config.supabaseUrl || !config.supabasePublishableKey) {
    const error = new Error("Supabase public configuration is incomplete");
    error.statusCode = 503;
    throw error;
  }
}

function requireSupabaseSecret() {
  if (!config.supabaseUrl || !config.supabaseSecretKey) {
    const error = new Error("Supabase server secret is not configured");
    error.statusCode = 503;
    throw error;
  }
}

async function verifyUserToken(token) {
  requireSupabasePublicConfig();

  if (!token || token.length < 40) {
    const error = new Error("Missing or invalid access token");
    error.statusCode = 401;
    throw error;
  }

  const response = await fetchWithTimeout(
    `${config.supabaseUrl}/auth/v1/user`,
    {
      method: "GET",
      headers: {
        apikey: config.supabasePublishableKey,
        Authorization: `Bearer ${token}`,
        Accept: "application/json"
      }
    }
  );

  const { body } = await parseResponse(response);
  if (!body?.id || !body?.email) {
    const error = new Error("Supabase user session is invalid");
    error.statusCode = 401;
    throw error;
  }

  return body;
}

async function secretRequest(pathname, {
  method = "GET",
  body,
  headers = {}
} = {}) {
  requireSupabaseSecret();

  const requestHeaders = {
    ...apiKeyHeaders(config.supabaseSecretKey),
    ...headers
  };

  let requestBody;
  if (body !== undefined) {
    requestHeaders["Content-Type"] = "application/json";
    requestBody = JSON.stringify(body);
  }

  const response = await fetchWithTimeout(
    `${config.supabaseUrl}${pathname}`,
    {
      method,
      headers: requestHeaders,
      body: requestBody
    }
  );

  return parseResponse(response);
}

async function databaseAdminRole(userId) {
  try {
    const query = new URLSearchParams({
      select: "user_id,role,active",
      user_id: `eq.${userId}`,
      active: "eq.true",
      limit: "1"
    });

    const { body } = await secretRequest(
      `/rest/v1/app_admins?${query.toString()}`
    );

    return Array.isArray(body) && body[0]
      ? {
          source: "database",
          role: body[0].role || "viewer"
        }
      : null;
  } catch (error) {
    if ([404, 406].includes(error.statusCode)) return null;
    throw error;
  }
}

async function resolveAdmin(user) {
  const normalizedEmail = String(user.email || "").trim().toLowerCase();
  const normalizedId = String(user.id || "").trim().toLowerCase();

  if (config.adminUserIds.has(normalizedId)) {
    return { source: "environment", role: "owner" };
  }

  if (config.adminEmails.has(normalizedEmail)) {
    return { source: "environment", role: "owner" };
  }

  if (!config.supabaseSecretKey) return null;
  return databaseAdminRole(user.id);
}

function bearerToken(req) {
  const value = String(req.headers.authorization || "");
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

async function authenticateAdmin(req) {
  if (!config.adminEnabled) {
    const error = new Error("Admin dashboard is disabled");
    error.statusCode = 404;
    throw error;
  }

  const user = await verifyUserToken(bearerToken(req));
  const membership = await resolveAdmin(user);

  if (!membership) {
    const error = new Error("This account is not authorized as an administrator");
    error.statusCode = 403;
    throw error;
  }

  return {
    user,
    role: membership.role,
    source: membership.source
  };
}

function maskEmail(email) {
  const [local = "", domain = ""] = String(email || "").split("@");
  if (!domain) return "—";
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(2, Math.min(6, local.length - visible.length)))}@${domain}`;
}

async function listAllAuthUsers({ maxPages = 20, perPage = 1000 } = {}) {
  const users = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const query = new URLSearchParams({
      page: String(page),
      per_page: String(perPage)
    });

    const { body } = await secretRequest(
      `/auth/v1/admin/users?${query.toString()}`
    );

    const pageUsers = Array.isArray(body?.users)
      ? body.users
      : Array.isArray(body)
        ? body
        : [];

    users.push(...pageUsers);

    if (pageUsers.length < perPage) break;
  }

  return users;
}

function authSummary(users) {
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;
  const sevenDays = 7 * oneDay;

  const createdWithin = duration =>
    users.filter(user => {
      const time = Date.parse(user.created_at || "");
      return Number.isFinite(time) && now - time <= duration;
    }).length;

  const signedInWithin = duration =>
    users.filter(user => {
      const time = Date.parse(user.last_sign_in_at || "");
      return Number.isFinite(time) && now - time <= duration;
    }).length;

  return {
    total: users.length,
    confirmed: users.filter(user => Boolean(user.email_confirmed_at || user.confirmed_at)).length,
    unconfirmed: users.filter(user => !user.email_confirmed_at && !user.confirmed_at).length,
    banned: users.filter(user => {
      const until = Date.parse(user.banned_until || "");
      return Number.isFinite(until) && until > now;
    }).length,
    created24h: createdWithin(oneDay),
    created7d: createdWithin(sevenDays),
    signedIn24h: signedInWithin(oneDay),
    signedIn7d: signedInWithin(sevenDays)
  };
}

async function databaseIntegrity() {
  const { body } = await secretRequest(
    "/rest/v1/rpc/admin_system_integrity",
    {
      method: "POST",
      body: {}
    }
  );

  return body;
}

async function authHealth() {
  requireSupabasePublicConfig();

  const response = await fetchWithTimeout(
    `${config.supabaseUrl}/auth/v1/health`,
    {
      method: "GET",
      headers: {
        apikey: config.supabasePublishableKey,
        Accept: "application/json"
      }
    }
  );

  const { body } = await parseResponse(response);
  return body || { status: "ok" };
}

function resultCheck(id, ok, level, label, detail) {
  return {
    id,
    ok: Boolean(ok),
    level,
    label,
    detail
  };
}

async function buildOverview({
  fuelStatus,
  force = false
} = {}) {
  const now = Date.now();

  if (
    !force &&
    overviewCache &&
    now - overviewCache.createdAt < config.adminCacheMs
  ) {
    return overviewCache.value;
  }

  const configuration = validateConfiguration({ strict: true });

  const [healthResult, usersResult, databaseResult] =
    await Promise.allSettled([
      authHealth(),
      listAllAuthUsers(),
      databaseIntegrity()
    ]);

  const users =
    usersResult.status === "fulfilled"
      ? usersResult.value
      : [];

  const auth = authSummary(users);
  const database =
    databaseResult.status === "fulfilled"
      ? databaseResult.value
      : null;

  const checks = [
    ...configuration.checks.map(check =>
      resultCheck(
        `config_${check.id}`,
        check.ok,
        check.severity === "critical" ? "critical" : "warning",
        `การตั้งค่า: ${check.id}`,
        check.message
      )
    ),
    resultCheck(
      "supabase_auth",
      healthResult.status === "fulfilled",
      "critical",
      "Supabase Auth",
      healthResult.status === "fulfilled"
        ? "เชื่อมต่อ Auth ได้"
        : healthResult.reason?.message || "เชื่อมต่อ Auth ไม่ได้"
    ),
    resultCheck(
      "auth_admin_api",
      usersResult.status === "fulfilled",
      "critical",
      "Auth Admin API",
      usersResult.status === "fulfilled"
        ? `อ่านบัญชีผู้ใช้ได้ ${auth.total.toLocaleString("th-TH")} บัญชี`
        : usersResult.reason?.message || "อ่านรายชื่อผู้ใช้ไม่ได้"
    ),
    resultCheck(
      "database_integrity_rpc",
      databaseResult.status === "fulfilled",
      "critical",
      "Database integrity function",
      databaseResult.status === "fulfilled"
        ? "เรียก admin_system_integrity ได้"
        : databaseResult.reason?.message || "ยังไม่ได้ติดตั้ง production migration"
    )
  ];

  if (database) {
    checks.push(
      resultCheck(
        "profiles_complete",
        Number(database.authless_profiles || 0) === 0,
        "warning",
        "โปรไฟล์อ้างอิงผู้ใช้ถูกต้อง",
        `โปรไฟล์ผิดปกติ ${Number(database.authless_profiles || 0).toLocaleString("th-TH")} รายการ`
      ),
      resultCheck(
        "sync_profile_match",
        Number(database.sync_without_profile || 0) === 0,
        "warning",
        "ข้อมูลซิงก์มีโปรไฟล์",
        `ข้อมูลซิงก์ที่ไม่มีโปรไฟล์ ${Number(database.sync_without_profile || 0).toLocaleString("th-TH")} รายการ`
      ),
      resultCheck(
        "payload_shape",
        Number(database.invalid_payloads || 0) === 0,
        "critical",
        "รูปแบบ payload",
        `payload ผิดรูปแบบ ${Number(database.invalid_payloads || 0).toLocaleString("th-TH")} รายการ`
      ),
      resultCheck(
        "payload_size",
        Number(database.large_payloads || 0) === 0,
        "warning",
        "ขนาดข้อมูลบัญชี",
        `payload เกิน 512 KB จำนวน ${Number(database.large_payloads || 0).toLocaleString("th-TH")} รายการ`
      )
    );
  }

  const criticalFailures = checks.filter(
    check => !check.ok && check.level === "critical"
  ).length;
  const warnings = checks.filter(
    check => !check.ok && check.level === "warning"
  ).length;

  const value = {
    generatedAt: new Date().toISOString(),
    status:
      criticalFailures > 0
        ? "critical"
        : warnings > 0
          ? "warning"
          : "healthy",
    criticalFailures,
    warnings,
    checks,
    auth,
    database,
    fuel: fuelStatus || null,
    deployment: {
      version: config.version,
      environment: config.environment,
      uptimeSeconds: Math.floor(process.uptime()),
      node: process.version,
      serviceName: config.render.serviceName || null,
      serviceId: config.render.serviceId || null,
      instanceId: config.render.instanceId || null,
      commit: config.render.commit || null,
      branch: config.render.branch || null,
      repo: config.render.repo || null,
      externalUrl: config.render.externalUrl || config.appOrigin || null
    }
  };

  overviewCache = {
    createdAt: now,
    value
  };

  return value;
}

async function listUsersPage({ page = 1, perPage = 25 } = {}) {
  const safePage = Math.max(1, Math.min(100000, Number(page) || 1));
  const safePerPage = Math.max(1, Math.min(100, Number(perPage) || 25));

  const query = new URLSearchParams({
    page: String(safePage),
    per_page: String(safePerPage)
  });

  const { body } = await secretRequest(
    `/auth/v1/admin/users?${query.toString()}`
  );

  const users = Array.isArray(body?.users)
    ? body.users
    : Array.isArray(body)
      ? body
      : [];

  return {
    page: safePage,
    perPage: safePerPage,
    users: users.map(user => ({
      id: user.id,
      emailMasked: maskEmail(user.email),
      confirmed: Boolean(user.email_confirmed_at || user.confirmed_at),
      createdAt: user.created_at || null,
      lastSignInAt: user.last_sign_in_at || null,
      bannedUntil: user.banned_until || null,
      displayName:
        String(user.user_metadata?.display_name || "")
          .trim()
          .slice(0, 80) || null
    }))
  };
}

async function listAuditLog({ page = 1, perPage = 30 } = {}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safePerPage = Math.max(1, Math.min(100, Number(perPage) || 30));
  const offset = (safePage - 1) * safePerPage;

  const query = new URLSearchParams({
    select:
      "id,admin_user_id,admin_email_masked,action,target_type,target_id,metadata,ip_hash,created_at",
    order: "created_at.desc",
    limit: String(safePerPage),
    offset: String(offset)
  });

  const { body } = await secretRequest(
    `/rest/v1/admin_audit_log?${query.toString()}`
  );

  return {
    page: safePage,
    perPage: safePerPage,
    entries: Array.isArray(body) ? body : []
  };
}

async function recordAudit({
  admin,
  action,
  targetType = "system",
  targetId = null,
  metadata = {},
  ipHash = null
}) {
  try {
    await secretRequest("/rest/v1/admin_audit_log", {
      method: "POST",
      headers: {
        Prefer: "return=minimal"
      },
      body: {
        admin_user_id: admin.user.id,
        admin_email_masked: maskEmail(admin.user.email),
        action: String(action).slice(0, 100),
        target_type: String(targetType).slice(0, 80),
        target_id: targetId ? String(targetId).slice(0, 160) : null,
        metadata,
        ip_hash: ipHash
      }
    });
  } catch (error) {
    // The admin action itself should still work if audit migration is missing.
    console.warn(JSON.stringify({
      level: "warn",
      event: "admin_audit_write_failed",
      message: error.message
    }));
  }
}

function invalidateOverviewCache() {
  overviewCache = null;
}

module.exports = {
  authenticateAdmin,
  verifyUserToken,
  resolveAdmin,
  buildOverview,
  listUsersPage,
  listAuditLog,
  recordAudit,
  invalidateOverviewCache,
  maskEmail,
  secretRequest
};
