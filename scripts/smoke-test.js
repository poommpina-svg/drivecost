"use strict";

const { spawn } = require("node:child_process");
const path = require("node:path");
const net = require("node:net");

const root = path.resolve(__dirname, "..");

function randomPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(error => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
    server.on("error", reject);
  });
}

async function waitFor(url, timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not become ready: ${url}`);
}

async function main() {
  const port = await randomPort();

  const child = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: "test",
      HOST: "127.0.0.1",
      PORT: String(port),
      ADMIN_DASHBOARD_ENABLED: "true"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stderr = "";
  child.stderr.on("data", chunk => {
    stderr += chunk.toString();
  });

  const origin = `http://127.0.0.1:${port}`;

  try {
    await waitFor(`${origin}/healthz`);

    const health = await fetch(`${origin}/healthz`);
    if (health.status !== 200) throw new Error("healthz failed");

    const ready = await fetch(`${origin}/readyz`);
    if (ready.status !== 503) {
      throw new Error("readyz should fail without production secrets");
    }

    const home = await fetch(`${origin}/`);
    const homeText = await home.text();
    if (home.status !== 200 || !homeText.includes("DriveCost")) {
      throw new Error("home page failed");
    }

    const csp = home.headers.get("content-security-policy") || "";
    if (!csp.includes("frame-ancestors 'none'")) {
      throw new Error("CSP missing");
    }

    const runtime = await fetch(`${origin}/runtime-config.js`);
    const runtimeText = await runtime.text();
    if (runtime.status !== 200 || runtimeText.includes("SUPABASE_SECRET_KEY")) {
      throw new Error("runtime config exposes invalid content");
    }

    const admin = await fetch(`${origin}/admin`);
    if (admin.status !== 200) throw new Error("admin page failed");
    if (!String(admin.headers.get("x-robots-tag")).includes("noindex")) {
      throw new Error("admin noindex header missing");
    }

    const sourceLeak = await fetch(`${origin}/server.js`);
    if (sourceLeak.status !== 404) {
      throw new Error("server.js is publicly accessible");
    }

    const traversal = await fetch(`${origin}/..%2Fserver.js`);
    if (traversal.status !== 404) {
      throw new Error("path traversal protection failed");
    }

    const badMethod = await fetch(`${origin}/api/fuel-prices`, {
      method: "POST"
    });
    if (badMethod.status !== 405) {
      throw new Error("API method guard failed");
    }

    console.log("Smoke test passed");
  } finally {
    child.kill("SIGTERM");
    await new Promise(resolve => {
      child.once("exit", resolve);
      setTimeout(resolve, 3000);
    });
  }

  if (stderr.trim()) {
    console.error(stderr);
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
