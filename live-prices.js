
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
    "เบนซิน 91": ["gasoline91"],
    "แก๊สโซฮอล์ 95": ["gasohol95", "premiumGasohol95"],
    "แก๊สโซฮอล์ 91": ["gasohol91"],
    "แก๊สโซฮอล์ E20": ["gasoholE20"],
    "แก๊สโซฮอล์ E85": ["gasoholE85"],
    "E20": ["gasoholE20"],
    "E85": ["gasoholE85"],
    "ดีเซล": ["diesel"],
    "ดีเซล B7": ["dieselB7", "diesel"],
    "ดีเซล B10": ["dieselB10"],
    "ดีเซล B20": ["dieselB20"],
    "ดีเซลพรีเมียม": ["premiumDiesel"],
    "NGV": ["ngv"],
    "Plug-in Hybrid": ["gasohol95", "gasoholE20", "gasoline95"]
  };

  const productTarget = {
    gasoline95: { mode: "fuel", type: "เบนซิน 95" },
    gasoline91: { mode: "fuel", type: "เบนซิน 91" },
    gasohol95: { mode: "fuel", type: "แก๊สโซฮอล์ 95" },
    premiumGasohol95: { mode: "fuel", type: "แก๊สโซฮอล์ 95" },
    gasohol91: { mode: "fuel", type: "แก๊สโซฮอล์ 91" },
    gasoholE20: { mode: "fuel", type: "แก๊สโซฮอล์ E20" },
    gasoholE85: { mode: "fuel", type: "แก๊สโซฮอล์ E85" },
    diesel: { mode: "diesel", type: "ดีเซล" },
    dieselB7: { mode: "diesel", type: "ดีเซล B7" },
    dieselB10: { mode: "diesel", type: "ดีเซล B10" },
    dieselB20: { mode: "diesel", type: "ดีเซล B20" },
    premiumDiesel: { mode: "diesel", type: "ดีเซลพรีเมียม" },
    ngv: { mode: "ngv", type: "NGV" }
  };

  function normalizedSelection(value) {
    return core.normalizeEnergyType
      ? core.normalizeEnergyType(value)
      : String(value || "").trim();
  }

  function modeAcceptsProduct(mode, targetMode) {
    return mode === targetMode || (mode === "hybrid" && targetMode === "fuel");
  }

  function targetTypeForMode(target, mode) {
    if (!target) return "";
    if (mode === "hybrid" && target.mode === "fuel") return target.type;
    return target.type;
  }

  let payload = null;
  let refreshPromise = null;
  let toastTimer = null;
  let lastManualRefreshAt = 0;
  let selectedProductId = "";
  let priceSelectionBusy = false;
  let busyProductId = "";

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

    const selection = normalizedSelection($("energyType")?.value || "");
    const explicitId = selectedProductId || storedProductIdForMode(core.mode);

    if (explicitId) {
      const explicitItem = payload.prices.find(item => item.id === explicitId);
      const target = productTarget[explicitId];
      const targetType = targetTypeForMode(target, core.mode);

      if (
        explicitItem &&
        target &&
        modeAcceptsProduct(core.mode, target.mode) &&
        (!selection || targetType === selection)
      ) {
        return explicitItem;
      }
    }

    const candidates = selectionMap[selection] || [];
    for (const id of candidates) {
      const target = productTarget[id];
      if (!target || !modeAcceptsProduct(core.mode, target.mode)) continue;
      const found = payload.prices.find(item => item.id === id);
      if (found) return found;
    }

    return null;
  }

  function restoreStoredProductSelection() {
    if (!payload) return null;

    const storedId = storedProductIdForMode(core.mode);
    const target = productTarget[storedId];
    const item = payload.prices.find(price => price.id === storedId);

    if (!storedId || !target || !item || !modeAcceptsProduct(core.mode, target.mode)) {
      selectedProductId = "";
      return null;
    }

    const targetType = targetTypeForMode(target, core.mode);
    const energyType = $("energyType");

    if (
      energyType &&
      [...energyType.options].some(option => option.value === targetType)
    ) {
      energyType.value = targetType;
    }

    selectedProductId = storedId;
    return item;
  }

  function renderEnergySelectionSummary() {
    const name = $("energySelectionName");
    const price = $("energySelectionPrice");
    const unit = $("energySelectionUnit");
    const source = $("energySelectionSource");

    if (!name || !price || !unit || !source) return;

    const selection = normalizedSelection($("energyType")?.value || "");
    const selected = currentSelectionProduct();
    const metadata = parse(storageGet(META_KEY), {})?.[core.mode] || {};
    const numericPrice = Number.parseFloat($("energyPrice")?.value);

    name.textContent = selection || core.energyData[core.mode]?.name || "พลังงาน";
    price.textContent = fmt(Number.isFinite(numericPrice) ? numericPrice : 0, 2);
    unit.textContent = core.energyData[core.mode]?.priceUnit || "บาท/หน่วย";

    if (selected) {
      source.textContent = `${selected.label} • ${payload?.provider || "แหล่งราคาพลังงาน"}`;
    } else if (metadata.sourceName) {
      source.textContent = metadata.sourceName;
    } else {
      source.textContent = "ราคาที่ผู้ใช้กำหนดหรือข้อมูลตัวอย่าง";
    }
  }

  function updateLivePriceSelection() {
    renderEnergySelectionSummary();
    const grid = $("livePriceGrid");
    if (!grid || !payload) return;

    const selected = currentSelectionProduct();

    grid.querySelectorAll("[data-live-card]").forEach(card => {
      const productId = card.dataset.liveCard || "";
      const active = selected?.id === productId;
      const busy = priceSelectionBusy && busyProductId === productId;
      const state = active ? "selected" : busy ? "busy" : "idle";
      const button = card.querySelector("[data-use-live-price]");

      card.classList.toggle("active", active);
      card.classList.toggle("busy", busy);
      card.dataset.state = state;

      if (active) card.setAttribute("aria-current", "true");
      else card.removeAttribute("aria-current");

      if (!button) return;

      button.dataset.state = state;
      button.disabled = active || priceSelectionBusy;
      button.setAttribute("aria-pressed", active ? "true" : "false");
      button.setAttribute(
        "aria-label",
        active
          ? `${card.querySelector("strong")?.textContent || "รายการนี้"} กำลังใช้อยู่`
          : busy
            ? "กำลังเปลี่ยนราคาพลังงาน"
            : `ใช้ราคา ${card.querySelector("strong")?.textContent || "รายการนี้"}`
      );

      button.textContent = active
        ? "✓ กำลังใช้อยู่"
        : busy
          ? "กำลังเปลี่ยน…"
          : priceSelectionBusy
            ? "รอสักครู่"
            : "ใช้ราคานี้";
    });
  }

  function renderLivePrices() {
    const grid = $("livePriceGrid");
    if (!grid || !payload) return;

    const selected = currentSelectionProduct();

    // Keep the provider order stable. Moving a selected card while the user is
    // pressing a button made the interface look like a second card was active.
    const orderedPrices = [...payload.prices];

    grid.innerHTML = orderedPrices.map(item => {
      const unit = item.unit === "THB/KG" ? "บาท/กก." : "บาท/ลิตร";
      const active = selected?.id === item.id;

      return `
        <article class="live-price-card ${active ? "active" : ""}"
                 data-live-card="${escapeHtml(item.id)}"
                 data-state="${active ? "selected" : "idle"}"
                 ${active ? 'aria-current="true"' : ""}>
          <small>${escapeHtml(item.product)}</small>
          <strong>${escapeHtml(item.label)}</strong>
          <b>${fmt(item.price, 2)} <span>${unit}</span></b>
          <button type="button"
                  data-use-live-price="${escapeHtml(item.id)}"
                  data-state="${active ? "selected" : "idle"}"
                  aria-pressed="${active ? "true" : "false"}"
                  aria-label="${active
                    ? `${escapeHtml(item.label)} กำลังใช้อยู่`
                    : `ใช้ราคา ${escapeHtml(item.label)}`}"
                  ${active ? "disabled" : ""}>
            ${active ? "✓ กำลังใช้อยู่" : "ใช้ราคานี้"}
          </button>
        </article>`;
    }).join("");

    updateLivePriceSelection();
  }

  function activateProductById(productId, triggerButton = null) {
    if (priceSelectionBusy || !payload) return false;

    const item = payload.prices.find(price => price.id === productId);
    const target = item ? productTarget[item.id] : null;
    if (!item || !target) return false;

    const previousProductId = selectedProductId;
    priceSelectionBusy = true;
    busyProductId = item.id;
    updateLivePriceSelection();

    try {
      const destinationMode =
        core.mode === "hybrid" && target.mode === "fuel"
          ? "hybrid"
          : target.mode;

      if (core.mode !== destinationMode) {
        core.setMode(destinationMode, false);
      }

      const targetType = targetTypeForMode(target, destinationMode);
      const energyType = $("energyType");
      if (
        energyType &&
        [...energyType.options].some(option => option.value === targetType)
      ) {
        energyType.value = targetType;
      }

      const applied = applyProduct(item, {
        mode: destinationMode,
        switchMode: false,
        manual: true
      });

      if (!applied) {
        selectedProductId = previousProductId;
        return false;
      }

      selectedProductId = item.id;
      window.dispatchEvent(new CustomEvent("drivecost:energyselectionchange", {
        detail: {
          productId: item.id,
          mode: destinationMode,
          energyType: targetType,
          price: item.price
        }
      }));

      return true;
    } catch (error) {
      selectedProductId = previousProductId;
      showToast("เปลี่ยนราคาพลังงานไม่สำเร็จ");
      console.error("Energy price selection failed", error);
      return false;
    } finally {
      priceSelectionBusy = false;
      busyProductId = "";
      updateLivePriceSelection();

      // Some mobile WebViews keep pointer focus after a tap. Removing focus
      // prevents an idle button from looking selected after another card wins.
      if (
        triggerButton &&
        triggerButton.matches(":focus") &&
        !triggerButton.matches(":focus-visible")
      ) {
        triggerButton.blur();
      }
    }

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
      const destinationMode =
        core.mode === "hybrid" && target.mode === "fuel"
          ? "hybrid"
          : target.mode;
      core.setMode(destinationMode, false);

      const targetType = targetTypeForMode(target, destinationMode);
      const energyType = $("energyType");
      if (
        energyType &&
        [...energyType.options].some(option => option.value === targetType)
      ) {
        energyType.value = targetType;
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
    renderEnergySelectionSummary();
    updateLivePriceSelection();
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
        restoreStoredProductSelection();
        applyCurrentSelection({ force: true });

        showToast(payload.stale ? "ใช้ราคาที่แคชไว้ล่าสุด" : "อัปเดตราคาน้ำมันแล้ว");
        announce(payload.stale ? "ใช้ราคาที่แคชไว้ล่าสุด" : "อัปเดตราคาน้ำมันจาก OR สำเร็จ");
        return payload;
      } catch (error) {
        const cached = readCachedPayload();
        if (cached) {
          payload = { ...cached.payload, stale: true };
          renderMetadata("cached");
          restoreStoredProductSelection();
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
    restoreStoredProductSelection();
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

  $("livePriceGrid")?.addEventListener("click", event => {
    const button = event.target.closest("[data-use-live-price]");
    if (!button || !event.currentTarget.contains(button)) return;
    activateProductById(button.dataset.useLivePrice || "", button);
  });

  $("refreshLivePricesButton")?.addEventListener("click", manualRefresh);
  $("inlineLiveRefreshButton")?.addEventListener("click", manualRefresh);
  $("livePriceAutoToggle")?.addEventListener("change", event => setAuto(event.target.checked));
  $("settingsLivePriceAuto")?.addEventListener("change", event => setAuto(event.target.checked));

  $("energyType")?.addEventListener("change", () => {
    selectedProductId = "";
    setTimeout(() => {
      if (getSettings().auto) applyCurrentSelection({ force: true });
      renderLivePrices();
      renderEnergySelectionSummary();
    }, 20);
  });

  $("energyPrice")?.addEventListener("input", () => {
    renderEnergySelectionSummary();
  });

  window.addEventListener("drivecost:modechange", () => {
    if (priceSelectionBusy) return;

    selectedProductId = "";
    setTimeout(() => {
      if (priceSelectionBusy) return;
      restoreStoredProductSelection();
      if (getSettings().auto) applyCurrentSelection({ force: true });
      renderLivePrices();
      renderEnergySelectionSummary();
    }, 60);
  });

  window.addEventListener("online", () => {
    if (getSettings().auto) fetchLivePrices(false).catch(() => {});
  });

  // Initialization
  const settings = getSettings();
  updateAutoControls(settings.auto);
  renderEnergySelectionSummary();
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
    activateProductById,
    currentSelectionProduct,
    restoreStoredProductSelection,
    renderEnergySelectionSummary,
    get productTarget() { return { ...productTarget }; },
    get payload() { return payload; },
    get selectedProductId() { return currentSelectionProduct()?.id || ""; },
    get busy() { return priceSelectionBusy; },
    get auto() { return getSettings().auto; }
  };
})();
