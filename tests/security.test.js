"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  securityHeaders,
  hashIp,
  SlidingWindowLimiter,
  sameOriginRequest
} = require("../server/security");

test("security headers include production protections", () => {
  const headers = securityHeaders({
    contentType: "text/html; charset=utf-8"
  });

  assert.match(headers["Content-Security-Policy"], /frame-ancestors 'none'/);
  assert.equal(headers["X-Frame-Options"], "DENY");
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.match(headers["Strict-Transport-Security"], /max-age=31536000/);
  assert.match(headers["Permissions-Policy"], /camera=\(\)/);
});

test("IP hash is deterministic and does not expose the raw IP", () => {
  const first = hashIp("203.0.113.4", "a".repeat(32));
  const second = hashIp("203.0.113.4", "a".repeat(32));

  assert.equal(first, second);
  assert.equal(first.length, 24);
  assert.doesNotMatch(first, /203\.0\.113\.4/);
});

test("rate limiter blocks requests after the limit", () => {
  const limiter = new SlidingWindowLimiter({
    windowMs: 60_000,
    limit: 2
  });

  assert.equal(limiter.allow("client").allowed, true);
  assert.equal(limiter.allow("client").allowed, true);

  const blocked = limiter.allow("client");
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfter >= 1);
});

test("same-origin guard accepts Render forwarded origin", () => {
  const request = {
    headers: {
      origin: "https://drivecost.example",
      "x-forwarded-proto": "https",
      "x-forwarded-host": "drivecost.example"
    }
  };

  assert.equal(
    sameOriginRequest(request, "https://drivecost.example"),
    true
  );

  request.headers.origin = "https://evil.example";
  assert.equal(
    sameOriginRequest(request, "https://drivecost.example"),
    false
  );
});
