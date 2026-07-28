(() => {
  "use strict";

  const version = "3.1.5";
  document.documentElement.dataset.drivecostBuild = version;

  window.addEventListener("load", async () => {
    if (!("serviceWorker" in navigator)) return;
    if (!window.isSecureContext) return;

    try {
      const registration = await navigator.serviceWorker.register(
        `/service-worker.js?v=${encodeURIComponent(version)}`,
        { scope: "/" }
      );
      registration.update().catch(() => {});
    } catch (error) {
      console.warn("Service Worker registration failed:", error?.message || error);
    }
  });
})();
