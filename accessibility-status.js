
(() => {
  "use strict";

  const core = window.DriveCostCore;
  const $ = id => document.getElementById(id);
  const ACCESS_KEY = "drivecost-v2.1-accessibility";
  const PRICE_KEY = "drivecost-v2-prices";
  const PRICE_UPDATED_KEY = "drivecost-v2-price-updated";
  const PRICE_META_KEY = "drivecost-v2-price-metadata";
  const SCENARIO_KEY = "drivecost-v2-scenarios";
  const HISTORY_KEY = "drivecost-v2-history";
  const APP_VERSION = "2.6.2";
  const FORMULA_VERSION = "1.2.0";

  const defaults = {
    textScale: 100,
    highContrast: false,
    largeControls: false,
    focusMode: true,
    motion: "system",
    announcements: true
  };

  let activePanel = null;
  let lastFocusedElement = null;
  let systemState = "checking";

  function safeParse(value, fallback) {
    if (!value) return fallback;
    try {
      const parsed = JSON.parse(value);
      return parsed ?? fallback;
    } catch {
      return fallback;
    }
  }

  function storageGet(key) {
    try { return localStorage.getItem(key); }
    catch { return null; }
  }

  function storageSet(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }

  function storageRemove(key) {
    try { localStorage.removeItem(key); }
    catch {}
  }

  function getPreferences() {
    return Object.assign({}, defaults, safeParse(storageGet(ACCESS_KEY), {}));
  }

  function savePreferences(preferences) {
    storageSet(ACCESS_KEY, JSON.stringify(preferences));
  }

  function prefersReducedMotion() {
    return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  }

  function applyPreferences(preferences, persist = true) {
    const scale = [100, 115, 130].includes(Number(preferences.textScale))
      ? Number(preferences.textScale)
      : 100;

    document.documentElement.style.setProperty("--a11y-zoom", String(scale / 100));
    document.body.classList.toggle("a11y-high-contrast", Boolean(preferences.highContrast));
    document.body.classList.toggle("a11y-large-controls", Boolean(preferences.largeControls));
    document.body.classList.toggle("a11y-focus-mode", Boolean(preferences.focusMode));

    const reduceMotion =
      preferences.motion === "reduce" ||
      (preferences.motion === "system" && prefersReducedMotion());

    document.body.classList.toggle("no-motion", reduceMotion);

    document.querySelectorAll("[data-text-scale]").forEach(button => {
      const selected = Number(button.dataset.textScale) === scale;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-pressed", selected ? "true" : "false");
    });

    $("a11yHighContrast").checked = Boolean(preferences.highContrast);
    $("a11yLargeControls").checked = Boolean(preferences.largeControls);
    $("a11yFocusMode").checked = Boolean(preferences.focusMode);
    $("a11yAnnouncements").checked = Boolean(preferences.announcements);

    document.querySelectorAll('input[name="motionPreference"]').forEach(radio => {
      radio.checked = radio.value === preferences.motion;
    });

    // Keep the legacy settings screen synchronized.
    const legacyReduceMotion = $("reduceMotion");
    if (legacyReduceMotion) legacyReduceMotion.checked = reduceMotion;

    if (persist) savePreferences({ ...preferences, textScale: scale });
  }

  function readPreferencesFromControls() {
    const selectedScale = document.querySelector("[data-text-scale].active");
    const selectedMotion = document.querySelector('input[name="motionPreference"]:checked');
    return {
      textScale: Number(selectedScale?.dataset.textScale || 100),
      highContrast: $("a11yHighContrast").checked,
      largeControls: $("a11yLargeControls").checked,
      focusMode: $("a11yFocusMode").checked,
      motion: selectedMotion?.value || "system",
      announcements: $("a11yAnnouncements").checked
    };
  }

  function announce(message) {
    if (!getPreferences().announcements) return;
    const live = $("screenReaderStatus");
    live.textContent = "";
    setTimeout(() => { live.textContent = message; }, 30);
  }

  function focusableElements(panel) {
    return [...panel.querySelectorAll(
      'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[href],[tabindex]:not([tabindex="-1"])'
    )].filter(element => !element.hidden && element.offsetParent !== null);
  }

  function openPanel(panelId, trigger) {
    closePanel(false);
    const panel = $(panelId);
    if (!panel) return;

    activePanel = panel;
    lastFocusedElement = trigger || document.activeElement;
    $("utilityBackdrop").hidden = false;
    panel.classList.add("open");
    panel.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";

    const focusables = focusableElements(panel);
    setTimeout(() => focusables[0]?.focus(), 30);

    if (panelId === "systemStatusPanel") refreshSystemStatus();
  }

  function closePanel(restoreFocus = true) {
    if (!activePanel) return;
    activePanel.classList.remove("open");
    activePanel.setAttribute("aria-hidden", "true");
    $("utilityBackdrop").hidden = true;
    document.body.style.overflow = "";
    const previous = lastFocusedElement;
    activePanel = null;
    lastFocusedElement = null;
    if (restoreFocus) setTimeout(() => previous?.focus(), 20);
  }

  function handlePanelKeyboard(event) {
    if (!activePanel) return;

    if (event.key === "Escape") {
      event.preventDefault();
      closePanel();
      return;
    }

    if (event.key !== "Tab") return;
    const focusables = focusableElements(activePanel);
    if (!focusables.length) return;

    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function setIndicator(element, state) {
    element.className = `status-indicator ${state}`;
  }

  function setStatusChip(state, label, summary) {
    systemState = state;
    setIndicator($("statusIndicator"), state);
    $("systemStatusLabel").textContent = label;
    $("systemStatusSummary").textContent = summary;
  }

  function setOverview(state, title, description) {
    setIndicator($("panelStatusIndicator"), state);
    $("panelStatusTitle").textContent = title;
    $("panelStatusDescription").textContent = description;
  }

  function setStatusValue(id, value, tone = "") {
    const element = $(id);
    element.textContent = value;
    element.className = tone;
  }

  async function checkNetwork() {
    const protocol = location.protocol;

    if (protocol === "file:" || protocol === "about:" || location.origin === "null") {
      return {
        state: "offline",
        value: "โหมดไฟล์ในเครื่อง",
        detail: "คำนวณได้ แต่ไม่ตรวจสอบอินเทอร์เน็ต"
      };
    }

    if (!navigator.onLine) {
      return {
        state: "offline",
        value: "ออฟไลน์",
        detail: "ใช้ไฟล์และข้อมูลที่บันทึกในเครื่อง"
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);

    try {
      const response = await fetch(`./manifest.json?health=${Date.now()}`, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal
      });

      if (!response.ok) throw new Error("Health check failed");
      return {
        state: "online",
        value: "ออนไลน์",
        detail: "เชื่อมต่อและอ่านไฟล์แอพสำเร็จ"
      };
    } catch {
      return {
        state: "offline",
        value: "เชื่อมต่อเครือข่าย แต่ตรวจเซิร์ฟเวอร์ไม่ได้",
        detail: "แอพยังคำนวณจากข้อมูลในเครื่องได้"
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async function checkServiceWorker() {
    const secureContext =
      location.protocol === "https:" ||
      location.hostname === "localhost" ||
      location.hostname === "127.0.0.1";

    if (!("serviceWorker" in navigator)) {
      return { value: "เบราว์เซอร์ไม่รองรับ", tone: "warn" };
    }

    if (!secureContext) {
      return {
        value: "พร้อมเมื่อเปิดผ่าน HTTPS/localhost",
        tone: "warn"
      };
    }

    try {
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration) {
        return { value: "กำลังติดตั้งไฟล์ออฟไลน์", tone: "warn" };
      }
      if (navigator.serviceWorker.controller) {
        return { value: "พร้อมใช้งานออฟไลน์", tone: "good" };
      }
      return { value: "ติดตั้งแล้ว • เปิดแอพใหม่อีกครั้ง", tone: "warn" };
    } catch {
      return { value: "ตรวจสอบไม่ได้", tone: "warn" };
    }
  }

  async function checkVehicleAssets() {
    if (!core?.vehicleData) return { value: "ไม่พบข้อมูลโมเดล", tone: "bad" };

    const assets = Object.values(core.vehicleData).map(data => data.image);
    const results = await Promise.all(assets.map(source => new Promise(resolve => {
      const image = new Image();
      const timer = setTimeout(() => resolve(false), 3500);
      image.onload = () => { clearTimeout(timer); resolve(true); };
      image.onerror = () => { clearTimeout(timer); resolve(false); };
      image.src = source;
    })));

    const ready = results.filter(Boolean).length;
    return {
      value: `${ready}/${assets.length} โมเดลพร้อม`,
      tone: ready === assets.length ? "good" : ready > 0 ? "warn" : "bad"
    };
  }

  async function checkStorage() {
    let available = false;
    const testKey = "__drivecost_storage_test__";

    try {
      localStorage.setItem(testKey, "1");
      localStorage.removeItem(testKey);
      available = true;
    } catch {
      available = false;
    }

    if (!available) return { value: "เบราว์เซอร์จำกัดการจัดเก็บ", tone: "warn" };

    if (navigator.storage?.estimate) {
      try {
        const estimate = await navigator.storage.estimate();
        const usageMb = (estimate.usage || 0) / 1024 / 1024;
        return {
          value: `พร้อม • ใช้ ${usageMb < 0.1 ? "<0.1" : usageMb.toFixed(1)} MB`,
          tone: "good"
        };
      } catch {}
    }

    return { value: "พร้อมใช้งาน", tone: "good" };
  }

  function countLocalData() {
    const scenarios = safeParse(storageGet(SCENARIO_KEY), []);
    const history = safeParse(storageGet(HISTORY_KEY), []);
    return {
      scenarios: Array.isArray(scenarios) ? scenarios.length : 0,
      history: Array.isArray(history) ? history.length : 0
    };
  }

  function updatePriceStatus() {
    const customPrices = safeParse(storageGet(PRICE_KEY), null);
    const metadata = safeParse(storageGet(PRICE_META_KEY), {});
    const currentMode = window.DriveCostCore?.mode || "fuel";
    const currentMeta = metadata[currentMode] || null;
    const updatedAt = currentMeta?.updatedAt || storageGet(PRICE_UPDATED_KEY);

    const sourceLabels = {
      system_sample: "ข้อมูลตัวอย่างของระบบ",
      user: "ผู้ใช้กำหนดเอง",
      receipt: "ใบเสร็จ / สถานีบริการ",
      provider: "ผู้ให้บริการพลังงาน",
      company: "ราคาของบริษัท / องค์กร",
      external: "แหล่งข้อมูลภายนอก / API"
    };

    if (currentMeta) {
      const label = sourceLabels[currentMeta.sourceType] || "ไม่ระบุประเภท";
      const sourceName = currentMeta.sourceName || label;
      const tone = currentMeta.sourceType === "system_sample" ? "warn" : "good";
      setStatusValue("priceSourceValue", `${label} • ${sourceName}`, tone);
      setStatusValue(
        "priceUpdatedValue",
        updatedAt ? new Date(updatedAt).toLocaleString("th-TH") : "ยังไม่มีการแก้ไข",
        ""
      );
    } else if (customPrices && Object.keys(customPrices).length) {
      setStatusValue("priceSourceValue", "ผู้ใช้กำหนด • ยังไม่ระบุแหล่งข้อมูล", "warn");
      setStatusValue(
        "priceUpdatedValue",
        updatedAt ? new Date(updatedAt).toLocaleString("th-TH") : "แก้ไขโดยผู้ใช้",
        ""
      );
    } else {
      setStatusValue("priceSourceValue", "ข้อมูลตัวอย่าง • ไม่ใช่ราคาสด", "warn");
      setStatusValue("priceUpdatedValue", "ยังไม่มีการแก้ไข", "");
    }
  }

  function updateLocalDataStatus() {
    const counts = countLocalData();
    setStatusValue(
      "localDataValue",
      `${counts.scenarios} สถานการณ์ • ${counts.history} ประวัติ`,
      ""
    );
  }

  async function refreshSystemStatus() {
    setStatusChip("checking", "กำลังตรวจสอบระบบ", "โปรดรอสักครู่");
    setOverview("checking", "กำลังตรวจสอบ", "กำลังอ่านสถานะของอุปกรณ์และแอพ");
    setStatusValue("networkStatusValue", "กำลังตรวจสอบ", "");
    setStatusValue("offlineStatusValue", "กำลังตรวจสอบ", "");
    setStatusValue("vehicleAssetStatusValue", "กำลังตรวจสอบ", "");
    setStatusValue("storageStatusValue", "กำลังตรวจสอบ", "");

    updatePriceStatus();
    updateLocalDataStatus();

    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      navigator.standalone === true;
    setStatusValue("displayModeValue", standalone ? "ติดตั้งเป็นแอพ" : "เว็บเบราว์เซอร์", standalone ? "good" : "");

    const [network, worker, assets, storage] = await Promise.all([
      checkNetwork(),
      checkServiceWorker(),
      checkVehicleAssets(),
      checkStorage()
    ]);

    setStatusValue(
      "networkStatusValue",
      network.value,
      network.state === "online" ? "good" : "warn"
    );
    setStatusValue("offlineStatusValue", worker.value, worker.tone);
    setStatusValue("vehicleAssetStatusValue", assets.value, assets.tone);
    setStatusValue("storageStatusValue", storage.value, storage.tone);

    const coreReady = Boolean(core?.calculate && core?.vehicleData);
    if (!coreReady || assets.tone === "bad") {
      setStatusChip("error", "ระบบต้องตรวจสอบ", "มีส่วนประกอบโหลดไม่ครบ");
      setOverview("error", "พบส่วนประกอบไม่พร้อม", "กรุณาเปิดแอพใหม่หรือตรวจสอบไฟล์โปรเจกต์");
      return;
    }

    if (network.state === "online") {
      setStatusChip("online", "ระบบพร้อมใช้งาน", "ออนไลน์ • ข้อมูลเก็บในเครื่อง");
      setOverview("online", "ระบบทำงานปกติ", `แอพ ${APP_VERSION} • สูตรคำนวณ ${FORMULA_VERSION}`);
    } else if (location.protocol === "file:" || location.protocol === "about:" || location.origin === "null") {
      setStatusChip("offline", "โหมดไฟล์ในเครื่อง", "คำนวณได้ • ไม่ตรวจอินเทอร์เน็ต");
      setOverview("offline", "กำลังทำงานในเครื่อง", "ฟังก์ชันคำนวณพร้อมใช้งาน การอัปเดตอัตโนมัติต้องเปิดผ่าน HTTPS/localhost");
    } else {
      setStatusChip("offline", "ออฟไลน์ แต่ใช้งานได้", "ใช้ข้อมูลและไฟล์ในเครื่อง");
      setOverview("offline", "ใช้งานแบบออฟไลน์", "ยังคำนวณและเปิดข้อมูลที่บันทึกไว้ได้");
    }
  }

  async function checkForUpdate() {
    const button = $("checkUpdateButton");
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "กำลังตรวจสอบ…";

    try {
      const secureContext =
        location.protocol === "https:" ||
        location.hostname === "localhost" ||
        location.hostname === "127.0.0.1";

      if (!secureContext || !("serviceWorker" in navigator)) {
        announce("การอัปเดตอัตโนมัติต้องเปิดแอพผ่าน HTTPS หรือ localhost");
        button.textContent = "ต้องใช้ HTTPS/localhost";
        return;
      }

      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration) {
        button.textContent = "ยังไม่ติดตั้งระบบอัปเดต";
        return;
      }

      await registration.update();
      if (registration.waiting) {
        button.textContent = "มีเวอร์ชันใหม่ • เปิดแอพใหม่";
        announce("มีเวอร์ชันใหม่พร้อมใช้งาน กรุณาเปิดแอพใหม่");
      } else {
        button.textContent = "ตรวจสอบไฟล์แอพแล้ว";
        announce("ตรวจสอบไฟล์แอพเรียบร้อยแล้ว");
      }
    } catch {
      button.textContent = "ตรวจสอบไม่สำเร็จ";
      announce("ไม่สามารถตรวจสอบเวอร์ชันได้ในขณะนี้");
    } finally {
      setTimeout(() => {
        button.disabled = false;
        button.textContent = original;
      }, 2600);
    }
  }

  function announceCalculation() {
    setTimeout(() => {
      const total = $("totalCost")?.textContent.trim() || "";
      const distance = $("totalDistance")?.textContent.trim() || "";
      const perPerson = $("costPerPerson")?.textContent.trim() || "";
      announce(`คำนวณเสร็จแล้ว ค่าเดินทางรวม ${total} ระยะทาง ${distance} เฉลี่ยต่อคน ${perPerson}`);
    }, 80);
  }

  // Panel controls
  $("accessibilityButton").addEventListener("click", event => {
    openPanel("accessibilityPanel", event.currentTarget);
  });
  $("systemStatusButton").addEventListener("click", event => {
    openPanel("systemStatusPanel", event.currentTarget);
  });
  $("utilityBackdrop").addEventListener("click", () => closePanel());
  document.querySelectorAll("[data-close-utility]").forEach(button => {
    button.addEventListener("click", () => closePanel());
  });
  document.addEventListener("keydown", handlePanelKeyboard);

  // Accessibility controls
  document.querySelectorAll("[data-text-scale]").forEach(button => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-text-scale]").forEach(item => item.classList.remove("active"));
      button.classList.add("active");
      applyPreferences(readPreferencesFromControls());
      announce(`ปรับขนาดหน้าจอเป็น ${button.dataset.textScale} เปอร์เซ็นต์`);
    });
  });

  ["a11yHighContrast", "a11yLargeControls", "a11yFocusMode", "a11yAnnouncements"].forEach(id => {
    $(id).addEventListener("change", () => applyPreferences(readPreferencesFromControls()));
  });

  document.querySelectorAll('input[name="motionPreference"]').forEach(radio => {
    radio.addEventListener("change", () => applyPreferences(readPreferencesFromControls()));
  });

  $("resetAccessibilityButton").addEventListener("click", () => {
    applyPreferences({ ...defaults });
    announce("คืนค่าการช่วยการเข้าถึงเป็นค่าเริ่มต้นแล้ว");
  });

  // Keep legacy reduced-motion switch synchronized.
  $("reduceMotion")?.addEventListener("change", event => {
    const preferences = getPreferences();
    preferences.motion = event.target.checked ? "reduce" : "full";
    applyPreferences(preferences);
  });

  // Status controls
  $("refreshSystemStatusButton").addEventListener("click", refreshSystemStatus);
  $("checkUpdateButton").addEventListener("click", checkForUpdate);
  window.addEventListener("online", refreshSystemStatus);
  window.addEventListener("offline", refreshSystemStatus);
  window.addEventListener("storage", refreshSystemStatus);
  window.addEventListener("drivecost:cloudapplied", () => {
    applyPreferences(getPreferences(), false);
    updatePriceStatus();
    updateLocalDataStatus();
  });
  window.addEventListener("drivecost:modechange", () => setTimeout(updatePriceStatus, 30));
  window.addEventListener("drivecost:pricesourcechange", () => setTimeout(updatePriceStatus, 30));

  // Track price update time after the existing price save handler completes.
  $("savePricesBtn")?.addEventListener("click", () => {
    storageSet(PRICE_UPDATED_KEY, new Date().toISOString());
    setTimeout(() => {
      updatePriceStatus();
      updateLocalDataStatus();
    }, 30);
  });

  // Announce calculation results and keep system counts fresh.
  $("calcBtn")?.addEventListener("click", () => {
    announceCalculation();
    setTimeout(updateLocalDataStatus, 60);
  });

  ["saveBtn", "saveTopBtn", "confirmSaveBtn", "newScenarioBtn", "mobileSaveBtn"].forEach(id => {
    $(id)?.addEventListener("click", () => setTimeout(updateLocalDataStatus, 100));
  });

  // Respect changes to OS motion preference while "ตามอุปกรณ์" is selected.
  window.matchMedia?.("(prefers-reduced-motion: reduce)")
    .addEventListener?.("change", () => {
      const preferences = getPreferences();
      if (preferences.motion === "system") applyPreferences(preferences, false);
    });

  applyPreferences(getPreferences(), false);
  refreshSystemStatus();

  // Public status for diagnostics or future integration.
  window.DriveCostStatus = {
    refresh: refreshSystemStatus,
    openAccessibility: () => openPanel("accessibilityPanel", $("accessibilityButton")),
    openSystemStatus: () => openPanel("systemStatusPanel", $("systemStatusButton")),
    get state() { return systemState; },
    appVersion: APP_VERSION,
    formulaVersion: FORMULA_VERSION
  };
})();
