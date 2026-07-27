
(() => {
  "use strict";

  const core = window.DriveCostCore;
  if (!core) {
    console.error("DriveCostCore is unavailable.");
    return;
  }

  const $ = id => document.getElementById(id);
  const CACHE_KEY = "drivecost-live-prices-v1";
  const SETTINGS_KEY = "drivecost-live-price-settings-v1";
  const PRICE_KEY = "drivecost-v2-prices";
  const META_KEY = "drivecost-v2-price-metadata";
  const PRICE_UPDATED_KEY = "drivecost-v2-price-updated";
  const SOURCE_URL = "https://orapiweb.pttor.com/oilservice/OilPrice.asmx";
  const API_URL = window.DRIVECOST_LIVE_PRICE_API || "/api/fuel-prices";
  const CLIENT_CACHE_MS = 30 * 60 * 1000;
  const OLD_DATA_MS = 36 * 60 * 60 * 1000;
  const MANUAL_REFRESH_COOLDOWN_MS = 15 * 1000;

  const selectionMap = {
    "เบนซิน 95": ["gasoline95"],
    "แก๊สโซฮอล์ 95": ["gasohol95", "premiumGasohol95"],
    "E20": ["gasoholE20"],
    "E85": ["gasoholE85"],
    "ดีเซล B7": ["dieselB7", "diesel"],
    "ดีเซล B10": ["dieselB10", "dieselB7", "diesel"],
    "ดีเซลพรีเมียม": ["premiumDiesel", "dieselB7", "diesel"],
    "NGV": ["ngv"],
    "ไฮบริด เบนซิน": ["gasohol95", "gasoline95"],
    "Plug-in Hybrid": ["gasohol95", "gasoline95"]
  };

  const productTarget = {
    gasoline95: { mode: "fuel", type: "เบนซิน 95" },
    gasoline91: { mode: "fuel", type: "เบนซิน 95" },
    gasohol95: { mode: "fuel", type: "แก๊สโซฮอล์ 95" },
    premiumGasohol95: { mode: "fuel", type: "แก๊สโซฮอล์ 95" },
    gasohol91: { mode: "fuel", type: "แก๊สโซฮอล์ 95" },
    gasoholE20: { mode: "fuel", type: "E20" },
    gasoholE85: { mode: "fuel", type: "E85" },
    diesel: { mode: "diesel", type: "ดีเซล B7" },
    dieselB7: { mode: "diesel", type: "ดีเซล B7" },
    dieselB10: { mode: "diesel", type: "ดีเซล B10" },
    dieselB20: { mode: "diesel", type: "ดีเซล B10" },
    premiumDiesel: { mode: "diesel", type: "ดีเซลพรีเมียม" },
    ngv: { mode: "ngv", type: "NGV" }
  };

  let payload = null;
  let refreshPromise = null;
  let toastTimer = null;
  let lastManualRefreshAt = 0;
  let selectedProductId = "";
  let priceSelectionBusy = false;

  function parse(value, fallback) {
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

  function getSettings() {
    return Object.assign({ auto: true }, parse(storageGet(SETTINGS_KEY), {}));
  }

  function saveSettings(settings) {
    storageSet(SETTINGS_KEY, JSON.stringify(settings));
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    })[character]);
  }

  function fmt(value, digits = 2) {
    return Number(value || 0).toLocaleString("th-TH", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function formatDate(value) {
    if (!value) return "ไม่ระบุ";
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "ไม่ระบุ";
    return date.toLocaleString("th-TH", {
      dateStyle: "medium",
      timeStyle: "short"
    });
  }

  function ageMs(value) {
    const time = Date.parse(value);
    return Number.isFinite(time) ? Date.now() - time : Number.POSITIVE_INFINITY;
  }

  function showToast(message) {
    let element = document.querySelector(".live-price-toast");
    if (!element) {
      element = document.createElement("div");
      element.className = "live-price-toast";
      element.setAttribute("role", "status");
      element.setAttribute("aria-live", "polite");
      document.body.appendChild(element);
    }

    element.textContent = message;
    element.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.classList.remove("show"), 2200);
  }

  function announce(message) {
    const live = $("screenReaderStatus");
    if (!live) return;
    live.textContent = "";
    setTimeout(() => { live.textContent = message; }, 30);
  }

  function validatePayload(data) {
    if (!data || !Array.isArray(data.prices)) throw new Error("รูปแบบข้อมูลราคาสดไม่ถูกต้อง");

    const prices = data.prices
      .map(item => ({
        id: String(item.id || ""),
        label: String(item.label || item.product || ""),
        product: String(item.product || item.label || ""),
        price: Number(item.price),
        unit: item.unit === "THB/KG" ? "THB/KG" : "THB/L",
        effectiveAt: item.effectiveAt || data.effectiveAt || null
      }))
      .filter(item =>
        productTarget[item.id] &&
        item.label &&
        Number.isFinite(item.price) &&
        item.price > 0 &&
        item.price < 200
      );

    if (!prices.length) throw new Error("ไม่พบราคาที่แอพรองรับ");

    return {
      provider: String(data.provider || "PTT OR OilPrice Web Service"),
      sourceUrl: SOURCE_URL,
      fetchedAt: data.fetchedAt || new Date().toISOString(),
      effectiveAt: data.effectiveAt || prices.find(item => item.effectiveAt)?.effectiveAt || null,
      stale: Boolean(data.stale),
      cache: String(data.cache || "unknown"),
      disclaimer: String(data.disclaimer || "ราคาขายปลีกอาจแตกต่างตามพื้นที่และสถานีบริการ"),
      prices
    };
  }

  function setSignal(state) {
    const signal = $("livePriceSignal");
    if (signal) signal.className = `live-price-signal ${state}`;
  }

  function setStatus(text, state = "checking") {
    setSignal(state);
    if ($("livePriceStatusText")) $("livePriceStatusText").textContent = text;
  }

  function storedProductIdForMode(mode = core.mode) {
    const metadata = parse(storageGet(META_KEY), {});
    const id = String(metadata?.[mode]?.productId || "");
    return payload?.prices.some(item => item.id === id) ? id : "";
  }

  function currentSelectionProduct() {
    if (!payload) return null;

    const selection = $("energyType")?.value || "";
    const explicitId = selectedProductId || storedProductIdForMode(core.mode);

    if (explicitId) {
      const explicitItem = payload.prices.find(item => item.id === explicitId);
      const target = productTarget[explicitId];

      if (
        explicitItem &&
        target?.mode === core.mode &&
        (!selection || target.type === selection)
      ) {
        return explicitItem;
      }
    }

    const candidates = selectionMap[selection] || [];
    for (const id of candidates) {
      const found = payload.prices.find(item => item.id === id);
      if (found) return found;
    }

    return null;
  }

  function updateLivePriceSelection() {
    const grid = $("livePriceGrid");
    if (!grid || !payload) return;

    const selected = currentSelectionProduct();

    grid.querySelectorAll("[data-live-card]").forEach(card => {
      const active = selected?.id === card.dataset.liveCard;
      const button = card.querySelector("[data-use-live-price]");

      card.classList.toggle("active", active);
      card.setAttribute("aria-current", active ? "true" : "false");

      if (!button) return;

      button.disabled = active || priceSelectionBusy;
      button.setAttribute("aria-pressed", active ? "true" : "false");
      button.textContent = active
        ? "กำลังใช้อยู่"
        : priceSelectionBusy
          ? "กรุณารอสักครู่"
          : "ใช้ราคานี้";
    });
  }

  function renderLivePrices() {
    const grid = $("livePriceGrid");
    if (!grid || !payload) return;

    const selected = currentSelectionProduct();

    grid.innerHTML = payload.prices.map(item => {
      const unit = item.unit === "THB/KG" ? "บาท/กก." : "บาท/ลิตร";
      const active = selected?.id === item.id;

      return `
        <article class="live-price-card ${active ? "active" : ""}"
                 data-live-card="${escapeHtml(item.id)}"
                 aria-current="${active ? "true" : "false"}">
          <small>${escapeHtml(item.product)}</small>
          <strong>${escapeHtml(item.label)}</strong>
          <b>${fmt(item.price, 2)} <span>${unit}</span></b>
          <button type="button"
                  data-use-live-price="${escapeHtml(item.id)}"
                  aria-pressed="${active ? "true" : "false"}"
                  ${active ? "disabled" : ""}>
            ${active ? "กำลังใช้อยู่" : "ใช้ราคานี้"}
          </button>
        </article>`;
    }).join("");

    grid.querySelectorAll("[data-use-live-price]").forEach(button => {
      button.addEventListener("click", () => {
        if (priceSelectionBusy || button.disabled) return;

        const item = payload.prices.find(price =>
          price.id === button.dataset.useLivePrice
        );
        const target = item ? productTarget[item.id] : null;

        if (!item || !target) return;

        priceSelectionBusy = true;
        selectedProductId = item.id;
        updateLivePriceSelection();

        try {
          if (core.mode !== target.mode) {
            core.setMode(target.mode, false);
          }

          const energyType = $("energyType");
          if ([...energyType.options].some(option => option.value === target.type)) {
            energyType.value = target.type;
          }

          applyProduct(item, {
            mode: target.mode,
            switchMode: false,
            manual: true
          });
        } finally {
          priceSelectionBusy = false;
          updateLivePriceSelection();
        }
      });
    });
  }

  function renderMetadata(state = "live") {
    if (!payload) return;

    $("livePriceProvider").textContent = payload.provider;
    $("livePriceEffectiveAt").textContent = formatDate(payload.effectiveAt);
    $("livePriceFetchedAt").textContent = formatDate(payload.fetchedAt);
    $("livePriceDisclaimer").textContent = payload.disclaimer;

    const old = ageMs(payload.effectiveAt || payload.fetchedAt) > OLD_DATA_MS;
    let freshness = "ข้อมูลสด";
    let tone = "live";

    if (payload.stale || old) {
      freshness = "ข้อมูลเก่า • ใช้ด้วยความระมัดระวัง";
      tone = "stale";
    } else if (state === "cached") {
      freshness = "แคชล่าสุดในอุปกรณ์";
      tone = "cached";
    }

    $("livePriceFreshness").textContent = freshness;
    $("livePriceFreshness").className =
      tone === "live" ? "live-price-good" :
      tone === "cached" ? "" :
      "live-price-warning";

    setStatus(
      tone === "live"
        ? "เชื่อมต่อสำเร็จ ระบบจะเลือกค่าตามชนิดน้ำมันที่ใช้อยู่"
        : tone === "cached"
          ? "ใช้ข้อมูลที่บันทึกไว้ล่าสุด ขณะรอตรวจสอบราคาใหม่"
          : "ข้อมูลอาจเก่า กรุณาตรวจสอบวันที่ราคามีผล",
      tone
    );

    renderLivePrices();
  }

  function writePriceSource(mode, item) {
    selectedProductId = item.id;
    const prices = parse(storageGet(PRICE_KEY), {});
    const metadata = parse(storageGet(META_KEY), {});
    const updatedAt = item.effectiveAt || payload.effectiveAt || payload.fetchedAt || new Date().toISOString();

    prices[mode] = item.price;
    metadata[mode] = {
      sourceType: "external",
      sourceName: payload.provider,
      sourceUrl: SOURCE_URL,
      note: `${item.label} (${item.product}) • ราคาขายปลีกอ้างอิงจาก OR` +
        (payload.stale ? " • ใช้ข้อมูลแคชเนื่องจากอัปเดตสดไม่สำเร็จ" : ""),
      updatedAt,
      fetchedAt: payload.fetchedAt,
      productId: item.id,
      productName: item.product,
      live: !payload.stale
    };

    storageSet(PRICE_KEY, JSON.stringify(prices));
    storageSet(META_KEY, JSON.stringify(metadata));
    storageSet(PRICE_UPDATED_KEY, updatedAt);

    if (core.energyData[mode]) core.energyData[mode].price = item.price;
    return metadata[mode];
  }

  function applyProduct(item, options = {}) {
    if (!item || !payload) return false;

    const target = productTarget[item.id];
    const mode = options.mode || target?.mode || core.mode;

    if (options.switchMode && target) {
      core.setMode(target.mode, false);
      const energyType = $("energyType");
      if ([...energyType.options].some(option => option.value === target.type)) {
        energyType.value = target.type;
      }
    }

    const metadata = writePriceSource(mode, item);
    const input = $("energyPrice");
    input.value = item.price.toFixed(2);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    core.calculate();

    window.dispatchEvent(new CustomEvent("drivecost:pricesourcechange", {
      detail: { mode, metadata, automatic: !options.manual }
    }));

    window.DriveCostProvenance?.updateCurrentPriceSource();
    if ($("page-energy")?.classList.contains("active")) {
      window.DriveCostPriceData?.renderPrices();
    }

    if (options.manual) {
      showToast(`ใช้ราคา ${item.label} ${fmt(item.price, 2)} บาทแล้ว`);
      announce(`อัปเดตราคา ${item.label} เป็น ${fmt(item.price, 2)} บาทต่อหน่วยแล้ว`);
    }

    return true;
  }

  function applyCurrentSelection(options = {}) {
    if (!payload || !getSettings().auto && !options.force) return false;
    const item = currentSelectionProduct();
    if (!item) return false;
    return applyProduct(item, {
      mode: core.mode,
      manual: Boolean(options.manual)
    });
  }

  function cachePayload(data) {
    storageSet(CACHE_KEY, JSON.stringify({
      storedAt: new Date().toISOString(),
      payload: data
    }));
  }

  function readCachedPayload() {
    const cached = parse(storageGet(CACHE_KEY), null);
    if (!cached?.payload) return null;
    try {
      return {
        storedAt: cached.storedAt,
        payload: validatePayload(cached.payload)
      };
    } catch {
      return null;
    }
  }

  async function fetchLivePrices(force = false) {
    if (refreshPromise) return refreshPromise;

    const button = $("refreshLivePricesButton");
    const buttonLabel = button?.querySelector("[data-refresh-label]");

    if (button) {
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
    }
    if (buttonLabel) buttonLabel.textContent = "กำลังอัปเดต…";

    setStatus("กำลังเชื่อมต่อกับระบบราคาน้ำมันของ OR", "checking");

    refreshPromise = (async () => {
      try {
        if (
          (location.protocol === "file:" || location.origin === "null") &&
          !window.__DRIVECOST_ALLOW_PREVIEW_API__
        ) {
          throw new Error("ต้องเปิดแอพผ่าน Node server เพื่อใช้งานราคาสด");
        }

        const separator = API_URL.includes("?") ? "&" : "?";
        let response = await fetch(`${API_URL}${force ? `${separator}refresh=1` : ""}`, {
          method: "GET",
          cache: "no-store",
          headers: { "Accept": "application/json" }
        });

        let data = await response.json().catch(() => ({}));

        // A forced refresh can be rate-limited. Fall back to the server cache automatically.
        if (response.status === 429 && force) {
          setStatus("กำลังใช้ราคาที่เซิร์ฟเวอร์แคชไว้ล่าสุด", "cached");
          response = await fetch(API_URL, {
            method: "GET",
            cache: "no-store",
            headers: { "Accept": "application/json" }
          });
          data = await response.json().catch(() => ({}));
        }

        if (!response.ok) throw new Error(data.message || data.error || "อัปเดตราคาไม่สำเร็จ");

        payload = validatePayload(data);
        cachePayload(payload);
        renderMetadata(payload.stale ? "stale" : "live");
        applyCurrentSelection({ force: true });

        showToast(payload.stale ? "ใช้ราคาที่แคชไว้ล่าสุด" : "อัปเดตราคาน้ำมันแล้ว");
        announce(payload.stale ? "ใช้ราคาที่แคชไว้ล่าสุด" : "อัปเดตราคาน้ำมันจาก OR สำเร็จ");
        return payload;
      } catch (error) {
        const cached = readCachedPayload();
        if (cached) {
          payload = { ...cached.payload, stale: true };
          renderMetadata("cached");
          applyCurrentSelection({ force: true });
          setStatus(`${error.message} • ใช้ราคาที่บันทึกไว้ล่าสุด`, "cached");
          showToast("เชื่อมต่อราคาสดไม่ได้ ใช้ราคาที่แคชไว้");
          return payload;
        }

        setStatus(error.message, "error");
        $("livePriceFreshness").textContent = "ไม่มีข้อมูลราคาสด";
        $("livePriceFreshness").className = "live-price-bad";
        $("livePriceGrid").innerHTML =
          `<div class="live-price-empty">${escapeHtml(error.message)}<br>ยังสามารถกรอกราคาเองได้ตามปกติ</div>`;
        showToast(error.message);
        throw error;
      } finally {
        refreshPromise = null;
        if (button) {
          button.disabled = false;
          button.removeAttribute("aria-busy");
        }
        if (buttonLabel) buttonLabel.textContent = "อัปเดตราคาตอนนี้";
      }
    })();

    return refreshPromise;
  }

  function initializeFromCache() {
    const cached = readCachedPayload();
    if (!cached) return false;
    payload = cached.payload;
    const fresh = ageMs(cached.storedAt) < CLIENT_CACHE_MS;
    renderMetadata(fresh ? "cached" : "stale");
    if (getSettings().auto) applyCurrentSelection({ force: true });
    return fresh;
  }

  function updateAutoControls(enabled) {
    $("livePriceAutoToggle").checked = enabled;
    $("settingsLivePriceAuto").checked = enabled;
  }

  function setAuto(enabled) {
    const settings = getSettings();
    settings.auto = Boolean(enabled);
    saveSettings(settings);
    updateAutoControls(settings.auto);

    if (settings.auto) {
      applyCurrentSelection({ force: true });
      fetchLivePrices(false).catch(() => {});
      showToast("เปิดการอัปเดตราคาอัตโนมัติแล้ว");
    } else {
      showToast("ปิดการอัปเดตราคาอัตโนมัติแล้ว");
    }
  }

  // Controls
  function manualRefresh() {
    const now = Date.now();
    const remaining = MANUAL_REFRESH_COOLDOWN_MS - (now - lastManualRefreshAt);

    if (remaining > 0) {
      const seconds = Math.ceil(remaining / 1000);
      showToast(`ระบบอัปเดตอัตโนมัติอยู่แล้ว กรุณารอ ${seconds} วินาที`);
      announce(`กรุณารอ ${seconds} วินาทีก่อนตรวจราคาจากต้นทางอีกครั้ง`);
      return;
    }

    lastManualRefreshAt = now;
    fetchLivePrices(true).catch(() => {});
  }

  $("refreshLivePricesButton")?.addEventListener("click", manualRefresh);
  $("inlineLiveRefreshButton")?.addEventListener("click", manualRefresh);
  $("livePriceAutoToggle")?.addEventListener("change", event => setAuto(event.target.checked));
  $("settingsLivePriceAuto")?.addEventListener("change", event => setAuto(event.target.checked));

  $("energyType")?.addEventListener("change", () => {
    selectedProductId = "";
    setTimeout(() => {
      if (getSettings().auto) applyCurrentSelection({ force: true });
      renderLivePrices();
    }, 20);
  });

  window.addEventListener("drivecost:modechange", () => {
    selectedProductId = "";
    setTimeout(() => {
      if (getSettings().auto) applyCurrentSelection({ force: true });
      renderLivePrices();
    }, 60);
  });

  window.addEventListener("online", () => {
    if (getSettings().auto) fetchLivePrices(false).catch(() => {});
  });

  // Initialization
  const settings = getSettings();
  updateAutoControls(settings.auto);
  const cacheFresh = initializeFromCache();

  if (settings.auto) {
    if (!cacheFresh) {
      fetchLivePrices(false).catch(() => {});
    } else {
      // Refresh in the background after rendering the cached price immediately.
      setTimeout(() => fetchLivePrices(false).catch(() => {}), 600);
    }
  } else if (!payload) {
    setStatus("ปิดการอัปเดตอัตโนมัติ • กดปุ่มเพื่อดึงราคาวันนี้", "cached");
  }

  window.DriveCostLivePrices = {
    refresh: fetchLivePrices,
    applyCurrentSelection,
    get payload() { return payload; },
    get auto() { return getSettings().auto; }
  };
})();
