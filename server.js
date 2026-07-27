"use strict";

const http = require("node:http");
const fsp = require("node:fs/promises");
const path = require("node:path");
const zlib = require("node:zlib");
const crypto = require("node:crypto");
const { URL } = require("node:url");

const {
  config,
  validateConfiguration
} = require("./server/config");
const {
  securityHeaders,
  clientIp,
  hashIp,
  requestId,
  sendJson,
  sendText,
  SlidingWindowLimiter,
  sameOriginRequest
} = require("./server/security");
const {
  getFuelPrices,
  getFuelStatus
} = require("./server/fuel-prices");
const {
  authenticateAdmin,
  buildOverview,
  listUsersPage,
  listAuditLog,
  recordAudit,
  invalidateOverviewCache
} = require("./server/supabase-admin");

const ROOT = __dirname;

const MIME = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webp": "image/webp",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8"
});

const PUBLIC_FILES = new Set([
  "/index.html",
  "/admin.html",
  "/manifest.json",
  "/service-worker.js",
  "/robots.txt",
  "/app.bundle.css",
  "/admin.css",
  "/storage-scope.js",
  "/production-bootstrap.js",
  "/drive-engine.js",
  "/core-app.js",
  "/supabase-config.js",
  "/account-sync.js",
  "/app-v2.js",
  "/accessibility-status.js",
  "/provenance-calculation.js",
  "/live-prices.js",
  "/ui-guard.js",
  "/admin.js"
]);

const globalLimiter = new SlidingWindowLimiter({
  windowMs: 60_000,
  limit: 300
});
const fuelRefreshLimiter = new SlidingWindowLimiter({
  windowMs: 60_000,
  limit: 8
});
const adminLimiter = new SlidingWindowLimiter({
  windowMs: 60_000,
  limit: 120
});

const staticCache = new Map();

function log(level, event, fields = {}) {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    event,
    service: config.render.serviceName || "drivecost",
    version: config.version,
    ...fields
  };
  console.log(JSON.stringify(payload));
}

function runtimeConfigScript() {
  const publicConfig = {
    version: config.version,
    environment: config.environment,
    appOrigin:
      config.appOrigin ||
      config.render.externalUrl ||
      "",
    supabase: {
      url: config.supabaseUrl,
      publishableKey: config.supabasePublishableKey
    },
    admin: {
      enabled: config.adminEnabled,
      path: "/admin"
    }
  };

  return Buffer.from(
    `"use strict";\n` +
    `window.DRIVECOST_RUNTIME_CONFIG=${JSON.stringify(publicConfig)};\n` +
    `window.DRIVECOST_SUPABASE_CONFIG=window.DRIVECOST_RUNTIME_CONFIG.supabase;\n`
  );
}

function publicStatus() {
  return {
    ok: true,
    version: config.version,
    environment: config.environment,
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    fuel: getFuelStatus(),
    services: {
      supabaseConfigured: Boolean(
        config.supabaseUrl &&
        config.supabasePublishableKey
      ),
      adminEnabled: config.adminEnabled
    },
    deployment: {
      service: config.render.serviceName || null,
      commit: config.render.commit
        ? config.render.commit.slice(0, 12)
        : null,
      branch: config.render.branch || null
    }
  };
}

function routeStaticPath(pathname) {
  if (pathname === "/") return "/index.html";
  if (pathname === "/admin" || pathname === "/admin/") return "/admin.html";
  return pathname;
}

function isAllowedStaticPath(pathname) {
  if (PUBLIC_FILES.has(pathname)) return true;
  return /^\/assets\/[a-z0-9._-]+\.(webp|png|svg)$/i.test(pathname);
}

async function loadStaticFile(pathname) {
  const cached = staticCache.get(pathname);
  if (cached) return cached;

  const absolute = path.resolve(ROOT, `.${pathname}`);
  if (!absolute.startsWith(`${ROOT}${path.sep}`)) {
    const error = new Error("Forbidden");
    error.statusCode = 403;
    throw error;
  }

  const data = await fsp.readFile(absolute);
  const ext = path.extname(absolute).toLowerCase();
  const etag = `"${crypto.createHash("sha256").update(data).digest("hex").slice(0, 24)}"`;
  const gzip =
    data.length >= 1024 &&
    ![".webp", ".png", ".ico"].includes(ext)
      ? zlib.gzipSync(data, { level: 6 })
      : null;

  const entry = {
    data,
    gzip,
    etag,
    contentType: MIME[ext] || "application/octet-stream",
    ext
  };

  staticCache.set(pathname, entry);
  return entry;
}

function cacheControlFor(pathname, ext) {
  if (pathname === "/index.html" || pathname === "/admin.html") {
    return "no-store, max-age=0";
  }
  if (pathname === "/service-worker.js") {
    return "no-cache, max-age=0";
  }
  if (pathname === "/manifest.json") {
    return "public, max-age=3600";
  }
  if (pathname.startsWith("/assets/")) {
    return "public, max-age=604800, immutable";
  }
  if ([".js", ".css"].includes(ext)) {
    return "public, max-age=86400, stale-while-revalidate=604800";
  }
  return "public, max-age=3600";
}

async function serveStatic(req, res, pathname) {
  const routed = routeStaticPath(pathname);

  if (!isAllowedStaticPath(routed)) {
    sendText(res, 404, "Not Found");
    return 404;
  }

  try {
    const file = await loadStaticFile(routed);

    if (req.headers["if-none-match"] === file.etag) {
      res.writeHead(
        304,
        securityHeaders({
          cacheControl: cacheControlFor(routed, file.ext),
          etag: file.etag
        })
      );
      res.end();
      return 304;
    }

    const acceptsGzip = /\bgzip\b/i.test(
      String(req.headers["accept-encoding"] || "")
    );
    const body = acceptsGzip && file.gzip ? file.gzip : file.data;

    const extra = {
      Vary: "Accept-Encoding",
      "X-Content-Type-Options": "nosniff"
    };

    if (acceptsGzip && file.gzip) {
      extra["Content-Encoding"] = "gzip";
    }

    if (routed === "/admin.html") {
      extra["X-Robots-Tag"] = "noindex, nofollow, noarchive";
    }

    res.writeHead(
      200,
      securityHeaders({
        contentType: file.contentType,
        contentLength: body.length,
        cacheControl: cacheControlFor(routed, file.ext),
        etag: file.etag,
        extra
      })
    );

    res.end(req.method === "HEAD" ? undefined : body);
    return 200;
  } catch (error) {
    const status = error.code === "ENOENT"
      ? 404
      : error.statusCode || 500;
    sendText(res, status, status === 404 ? "Not Found" : "Internal Server Error");
    return status;
  }
}

async function handleAdminApi(req, res, url, ipHashValue) {
  const rate = adminLimiter.allow(ipHashValue);
  if (!rate.allowed) {
    sendJson(
      res,
      429,
      {
        error: "admin_rate_limited",
        message: "กรุณารอสักครู่ก่อนเรียกหน้าผู้ดูแลอีกครั้ง"
      },
      { "Retry-After": String(rate.retryAfter) }
    );
    return 429;
  }

  if (
    ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) &&
    !sameOriginRequest(
      req,
      config.appOrigin || config.render.externalUrl
    )
  ) {
    sendJson(res, 403, {
      error: "origin_rejected",
      message: "คำขอนี้ไม่ได้มาจากเว็บไซต์ DriveCost"
    });
    return 403;
  }

  let admin;
  try {
    admin = await authenticateAdmin(req);
  } catch (error) {
    const status = error.statusCode || 401;
    sendJson(res, status, {
      error: status === 403 ? "admin_forbidden" : "admin_unauthorized",
      message: error.message
    });
    return status;
  }

  if (url.pathname === "/api/admin/me" && req.method === "GET") {
    sendJson(res, 200, {
      authorized: true,
      user: {
        id: admin.user.id,
        email: admin.user.email,
        displayName:
          admin.user.user_metadata?.display_name || null
      },
      role: admin.role,
      source: admin.source
    });
    return 200;
  }

  if (url.pathname === "/api/admin/overview" && req.method === "GET") {
    try {
      const overview = await buildOverview({
        fuelStatus: getFuelStatus(),
        force: url.searchParams.get("fresh") === "1"
      });
      sendJson(res, 200, overview);
      return 200;
    } catch (error) {
      sendJson(res, 502, {
        error: "overview_failed",
        message: error.message
      });
      return 502;
    }
  }

  if (url.pathname === "/api/admin/users" && req.method === "GET") {
    try {
      const result = await listUsersPage({
        page: url.searchParams.get("page"),
        perPage: url.searchParams.get("perPage")
      });
      sendJson(res, 200, result);
      return 200;
    } catch (error) {
      sendJson(res, 502, {
        error: "users_failed",
        message: error.message
      });
      return 502;
    }
  }

  if (url.pathname === "/api/admin/audit" && req.method === "GET") {
    try {
      const result = await listAuditLog({
        page: url.searchParams.get("page"),
        perPage: url.searchParams.get("perPage")
      });
      sendJson(res, 200, result);
      return 200;
    } catch (error) {
      sendJson(res, 502, {
        error: "audit_failed",
        message: error.message
      });
      return 502;
    }
  }

  if (
    url.pathname === "/api/admin/run-check" &&
    req.method === "POST"
  ) {
    try {
      invalidateOverviewCache();
      const overview = await buildOverview({
        fuelStatus: getFuelStatus(),
        force: true
      });

      await recordAudit({
        admin,
        action: "run_integrity_check",
        metadata: {
          status: overview.status,
          criticalFailures: overview.criticalFailures,
          warnings: overview.warnings
        },
        ipHash: ipHashValue
      });

      sendJson(res, 200, overview);
      return 200;
    } catch (error) {
      sendJson(res, 502, {
        error: "integrity_check_failed",
        message: error.message
      });
      return 502;
    }
  }

  if (
    url.pathname === "/api/admin/fuel/refresh" &&
    req.method === "POST"
  ) {
    const rate = fuelRefreshLimiter.allow(`admin:${ipHashValue}`);
    if (!rate.allowed) {
      sendJson(
        res,
        429,
        {
          error: "fuel_refresh_rate_limited",
          message: "กรุณารอก่อนตรวจราคาจากต้นทางอีกครั้ง"
        },
        { "Retry-After": String(rate.retryAfter) }
      );
      return 429;
    }

    try {
      const payload = await getFuelPrices(true);
      invalidateOverviewCache();

      await recordAudit({
        admin,
        action: "refresh_fuel_prices",
        targetType: "fuel_prices",
        metadata: {
          provider: payload.provider,
          fetchedAt: payload.fetchedAt,
          effectiveAt: payload.effectiveAt,
          stale: payload.stale,
          count: payload.prices?.length || 0
        },
        ipHash: ipHashValue
      });

      sendJson(res, 200, {
        ok: true,
        payload,
        status: getFuelStatus()
      });
      return 200;
    } catch (error) {
      sendJson(res, 502, {
        error: "fuel_refresh_failed",
        message: error.message
      });
      return 502;
    }
  }

  sendJson(res, 404, {
    error: "admin_route_not_found"
  });
  return 404;
}

async function handleRequest(req, res) {
  const startedAt = Date.now();
  const id = requestId(req);
  const ip = clientIp(req);
  const ipHashValue = hashIp(ip, config.ipHashSalt);

  res.setHeader("X-Request-ID", id);

  let status = 500;

  res.once("finish", () => {
    log("info", "http_request", {
      requestId: id,
      method: req.method,
      path: String(req.url || "").split("?")[0],
      status: res.statusCode,
      durationMs: Date.now() - startedAt,
      ipHash: ipHashValue
    });
  });

  const globalRate = globalLimiter.allow(ipHashValue);
  if (!globalRate.allowed) {
    sendJson(
      res,
      429,
      {
        error: "rate_limited",
        message: "มีคำขอมากเกินไป กรุณาลองใหม่ภายหลัง"
      },
      { "Retry-After": String(globalRate.retryAfter) }
    );
    return;
  }

  let url;
  try {
    url = new URL(
      req.url,
      `https://${req.headers.host || "localhost"}`
    );
  } catch {
    sendJson(res, 400, { error: "invalid_url" });
    return;
  }

  if (url.pathname === "/healthz" && req.method === "GET") {
    sendJson(res, 200, {
      ok: true,
      version: config.version,
      uptimeSeconds: Math.floor(process.uptime())
    });
    return;
  }

  if (url.pathname === "/readyz" && req.method === "GET") {
    const validation = validateConfiguration({ strict: true });
    sendJson(
      res,
      validation.ok ? 200 : 503,
      {
        ok: validation.ok,
        version: config.version,
        checks: validation.checks.map(check => ({
          id: check.id,
          ok: check.ok,
          severity: check.severity
        }))
      }
    );
    return;
  }

  if (
    url.pathname === "/runtime-config.js" &&
    req.method === "GET"
  ) {
    const body = runtimeConfigScript();
    res.writeHead(
      200,
      securityHeaders({
        contentType: "text/javascript; charset=utf-8",
        contentLength: body.length,
        cacheControl: "no-store, max-age=0"
      })
    );
    res.end(body);
    return;
  }

  if (
    url.pathname === "/api/system/status" &&
    req.method === "GET"
  ) {
    sendJson(res, 200, publicStatus());
    return;
  }

  if (url.pathname === "/api/fuel-prices") {
    if (req.method !== "GET") {
      sendJson(
        res,
        405,
        { error: "method_not_allowed" },
        { Allow: "GET" }
      );
      return;
    }

    const force = url.searchParams.get("refresh") === "1";
    if (force) {
      const rate = fuelRefreshLimiter.allow(ipHashValue);
      if (!rate.allowed) {
        sendJson(
          res,
          429,
          {
            error: "fuel_refresh_rate_limited",
            message: "กรุณารอก่อนตรวจราคาจากต้นทางอีกครั้ง"
          },
          { "Retry-After": String(rate.retryAfter) }
        );
        return;
      }
    }

    try {
      const payload = await getFuelPrices(force);
      sendJson(res, 200, payload, {
        "Cache-Control": force
          ? "no-store"
          : "public, max-age=300"
      });
    } catch (error) {
      sendJson(res, 502, {
        error: "fuel_prices_unavailable",
        message: error.message,
        fallback: "ใช้ราคาที่แคชไว้หรือกรอกราคาเอง"
      });
    }
    return;
  }

  if (url.pathname.startsWith("/api/admin/")) {
    await handleAdminApi(req, res, url, ipHashValue);
    return;
  }

  if (!["GET", "HEAD"].includes(req.method)) {
    sendJson(
      res,
      405,
      { error: "method_not_allowed" },
      { Allow: "GET, HEAD" }
    );
    return;
  }

  await serveStatic(req, res, url.pathname);
}

const validation = validateConfiguration({
  strict: config.environment === "production"
});

if (!validation.ok) {
  log("error", "configuration_invalid", {
    failed: validation.failedCritical.map(check => check.id)
  });
  process.exit(1);
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch(error => {
    log("error", "unhandled_request_error", {
      message: error.message,
      stack: config.environment === "production"
        ? undefined
        : error.stack
    });

    if (!res.headersSent) {
      sendJson(res, error.statusCode || 500, {
        error: "internal_server_error",
        message: "ระบบขัดข้องชั่วคราว"
      });
    } else {
      res.destroy();
    }
  });
});

server.requestTimeout = 30_000;
server.headersTimeout = 35_000;
server.keepAliveTimeout = 5_000;

server.listen(config.port, config.host, () => {
  log("info", "server_started", {
    host: config.host,
    port: config.port,
    environment: config.environment,
    render: Boolean(process.env.RENDER)
  });
});

function shutdown(signal) {
  log("info", "server_shutdown", { signal });
  server.close(error => {
    if (error) {
      log("error", "server_shutdown_failed", {
        message: error.message
      });
      process.exit(1);
    }
    process.exit(0);
  });

  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
