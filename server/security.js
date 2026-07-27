"use strict";

const crypto = require("node:crypto");

const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "worker-src 'self'",
  "manifest-src 'self'",
  "media-src 'none'",
  "upgrade-insecure-requests"
].join("; ");

function securityHeaders({
  contentType,
  cacheControl = "no-store",
  contentLength,
  etag,
  extra = {}
} = {}) {
  const headers = {
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-XSS-Protection": "0",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy":
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "Cache-Control": cacheControl,
    ...extra
  };

  if (contentType) headers["Content-Type"] = contentType;
  if (Number.isFinite(contentLength)) headers["Content-Length"] = String(contentLength);
  if (etag) headers.ETag = etag;

  return headers;
}

function clientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();
  return forwarded || req.socket.remoteAddress || "unknown";
}

function hashIp(ip, salt) {
  return crypto
    .createHash("sha256")
    .update(`${salt || "drivecost"}:${ip || "unknown"}`)
    .digest("hex")
    .slice(0, 24);
}

function requestId(req) {
  const incoming = String(req.headers["x-request-id"] || "").trim();
  if (/^[a-zA-Z0-9._:-]{8,128}$/.test(incoming)) return incoming;
  return crypto.randomUUID();
}

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(
    status,
    securityHeaders({
      contentType: "application/json; charset=utf-8",
      contentLength: body.length,
      extra: extraHeaders
    })
  );
  res.end(body);
}

function sendText(res, status, text, extraHeaders = {}) {
  const body = Buffer.from(String(text));
  res.writeHead(
    status,
    securityHeaders({
      contentType: "text/plain; charset=utf-8",
      contentLength: body.length,
      extra: extraHeaders
    })
  );
  res.end(body);
}

async function readJsonBody(req, limitBytes) {
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    total += chunk.length;
    if (total > limitBytes) {
      const error = new Error("Request body too large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  if (!chunks.length) return {};

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Invalid JSON body");
    error.statusCode = 400;
    throw error;
  }
}

class SlidingWindowLimiter {
  constructor({ windowMs, limit, maxEntries = 5000 }) {
    this.windowMs = windowMs;
    this.limit = limit;
    this.maxEntries = maxEntries;
    this.buckets = new Map();
  }

  allow(key) {
    const now = Date.now();
    const bucket = this.buckets.get(key);

    if (!bucket || now - bucket.startedAt >= this.windowMs) {
      this.buckets.set(key, { startedAt: now, count: 1 });
      this.prune(now);
      return { allowed: true, remaining: this.limit - 1, retryAfter: 0 };
    }

    bucket.count += 1;
    const allowed = bucket.count <= this.limit;
    const retryAfter = Math.max(
      1,
      Math.ceil((this.windowMs - (now - bucket.startedAt)) / 1000)
    );

    return {
      allowed,
      remaining: Math.max(0, this.limit - bucket.count),
      retryAfter
    };
  }

  prune(now = Date.now()) {
    if (this.buckets.size <= this.maxEntries) return;
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.startedAt >= this.windowMs) this.buckets.delete(key);
      if (this.buckets.size <= this.maxEntries) break;
    }
  }
}

function safeOrigin(req) {
  return String(req.headers.origin || "").trim();
}

function sameOriginRequest(req, configuredOrigin) {
  const origin = safeOrigin(req);
  if (!origin) return true;

  const forwardedProto = String(req.headers["x-forwarded-proto"] || "https");
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "");
  const requestOrigin = `${forwardedProto}://${host}`;

  return origin === configuredOrigin || origin === requestOrigin;
}

module.exports = {
  CSP,
  securityHeaders,
  clientIp,
  hashIp,
  requestId,
  sendJson,
  sendText,
  readJsonBody,
  SlidingWindowLimiter,
  sameOriginRequest
};
