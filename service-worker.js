"use strict";

const VERSION = "3.1.2";
const STATIC_CACHE = `drivecost-static-${VERSION}`;
const PAGE_CACHE = `drivecost-pages-${VERSION}`;

const PRECACHE = [
  "/",
  "/index.html",
  "/app.bundle.css?v=3.1.2",
  "/storage-scope.js?v=3.1.2",
  "/production-bootstrap.js?v=3.1.2",
  "/drive-engine.js?v=3.1.2",
  "/core-app.js?v=3.1.2",
  "/supabase-config.js?v=3.1.2",
  "/account-sync.js?v=3.1.2",
  "/app-v2.js?v=3.1.2",
  "/accessibility-status.js?v=3.1.2",
  "/provenance-calculation.js?v=3.1.2",
  "/live-prices.js?v=3.1.2",
  "/ui-guard.js?v=3.1.2",
  "/manifest.json?v=3.1.2",
  "/assets/sedan-3d.webp",
  "/assets/suv-3d.webp",
  "/assets/pickup-3d.webp",
  "/assets/van-3d.webp",
  "/assets/hybrid-3d.webp",
  "/assets/ev-3d.webp"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith("drivecost-") &&
            ![STATIC_CACHE, PAGE_CACHE].includes(key))
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return (
      await cache.match(request) ||
      await caches.match("/index.html") ||
      new Response("Offline", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      })
    );
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(STATIC_CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET") return;
  if (url.origin !== self.location.origin) return;

  if (
    url.pathname === "/runtime-config.js" ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/admin")
  ) {
    event.respondWith(fetch(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, PAGE_CACHE));
    return;
  }

  if (
    url.pathname.startsWith("/assets/") ||
    /\.(css|js|webp|png|svg|json)$/i.test(url.pathname)
  ) {
    event.respondWith(cacheFirst(request));
  }
});
