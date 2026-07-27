"use strict";

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "https://demo-project.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_demo_1234567890123456789012345678901234567890";
process.env["SUPABASE_" + "SECRET_KEY"] =
  "unit-test-server-key-1234567890123456789012345678901234567890";
process.env.ADMIN_EMAILS = "owner@example.com";
process.env.IP_HASH_SALT = "x".repeat(32);

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  authenticateAdmin,
  secretRequest,
  maskEmail
} = require("../server/supabase-admin");

test("authorized environment admin is accepted", async () => {
  const calls = [];
  const originalFetch = global.fetch;

  global.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify({
      id: "11111111-1111-4111-8111-111111111111",
      email: "owner@example.com",
      user_metadata: { display_name: "Owner" }
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  try {
    const admin = await authenticateAdmin({
      headers: {
        authorization: `Bearer ${"a".repeat(80)}`
      }
    });

    assert.equal(admin.role, "owner");
    assert.equal(admin.source, "environment");
    assert.equal(admin.user.email, "owner@example.com");
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].options.headers.apikey,
      process.env.SUPABASE_PUBLISHABLE_KEY
    );
    assert.match(
      calls[0].options.headers.Authorization,
      /^Bearer /
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("opaque Supabase secret is sent only in apikey", async () => {
  const originalFetch = global.fetch;
  let captured;

  global.fetch = async (url, options) => {
    captured = { url: String(url), options };
    return new Response("[]", {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  try {
    await secretRequest("/rest/v1/app_admins?select=user_id");

    assert.equal(
      captured.options.headers.apikey,
      process.env.SUPABASE_SECRET_KEY
    );
    assert.equal(
      captured.options.headers.Authorization,
      undefined
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("email masking limits personal-data exposure", () => {
  assert.equal(
    maskEmail("poommpina@example.com"),
    "po******@example.com"
  );
  assert.equal(maskEmail("a@example.com"), "a**@example.com");
});
