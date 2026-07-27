
(() => {
  "use strict";

  const core = window.DriveCostCore;
  if (!core) {
    console.error("DriveCostCore is unavailable.");
    return;
  }

  const $ = id => document.getElementById(id);
  const KEYS = {
    scenarios: "drivecost-v2-scenarios",
    history: "drivecost-v2-history",
    prices: "drivecost-v2-prices",
    priceMeta: "drivecost-v2-price-metadata",
    priceUpdated: "drivecost-v2-price-updated",
    settings: "drivecost-v2-settings",
    draft: "drivecost-v2-draft"
  };

  const memoryStorage = {};
  const storage = {
    getItem(key) {
      try { return window.localStorage.getItem(key); }
      catch { return Object.prototype.hasOwnProperty.call(memoryStorage, key) ? memoryStorage[key] : null; }
    },
    setItem(key, value) {
      try { window.localStorage.setItem(key, value); }
      catch { memoryStorage[key] = String(value); }
    },
    removeItem(key) {
      try { window.localStorage.removeItem(key); }
      catch { delete memoryStorage[key]; }
    }
  };

  const pageMeta = {
    calculator: ["คำนวณค่าใช้จ่ายการเดินทาง", "คำนวณได้ทุกพลังงาน • ทุกเส้นทาง • ทุกรูปแบบการขับขี่"],
    scenarios: ["สถานการณ์ของฉัน", "เปิดและจัดการรายการที่บันทึกไว้ในอุปกรณ์นี้"],
    vehicles: ["รถของฉัน", "เลือกโมเดลรถ 3D ที่ต้องการใช้กับเครื่องคำนวณ"],
    compare: ["เปรียบเทียบ", "เปรียบเทียบต้นทุนรถสองประเภทบนระยะทางเดียวกัน"],
    history: ["ประวัติการคำนวณ", "ตรวจสอบผลลัพธ์ที่เคยกดคำนวณ"],
    energy: ["ราคาและแหล่งข้อมูลพลังงาน", "ระบุราคา ที่มา และเวลาที่ตรวจสอบข้อมูล"],
    "calculation-details": ["รายละเอียดวิธีคำนวณ", "ตรวจสอบสูตรและค่าที่ใช้ในผลลัพธ์ปัจจุบัน"],
    account: ["บัญชีของฉัน", "เข้าสู่ระบบเพื่อบันทึกข้อมูลและใช้งานต่อบนอุปกรณ์อื่น"],
    settings: ["ตั้งค่า", "ปรับพฤติกรรมและการแสดงผลของแอพ"],
    guide: ["คู่มือการใช้งาน", "วิธีใช้งาน DriveCost ให้ได้ผลลัพธ์ใกล้เคียงความจริง"]
  };

  function parse(value, fallback) {
    if (value === null || value === undefined || value === "") return fallback;
    try {
      const parsed = JSON.parse(value);
      return parsed === null ? fallback : parsed;
    } catch {
      return fallback;
    }
  }

  function fmt(value, digits = 2) {
    return Number(value || 0).toLocaleString("th-TH", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;",
      '"': "&quot;", "'": "&#039;"
    })[char]);
  }

  function toast(message) {
    const el = $("toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove("show"), 1700);
  }

  function getSettings() {
    return Object.assign(
      { reduceMotion: false, autoDraft: true },
      parse(storage.getItem(KEYS.settings), {})
    );
  }

  function applySettings() {
    const settings = getSettings();
    document.body.classList.toggle("no-motion", settings.reduceMotion);
    $("reduceMotion").checked = settings.reduceMotion;
    $("autoDraft").checked = settings.autoDraft;
  }

  function showPage(page) {
    if (!pageMeta[page]) page = "calculator";

    document.querySelectorAll(".page-view").forEach(view => {
      view.classList.toggle("active", view.id === `page-${page}`);
    });

    document.querySelectorAll("[data-page]").forEach(button => {
      button.classList.toggle("active", button.dataset.page === page);
    });

    $("pageTitle").textContent = pageMeta[page][0];
    $("pageSubtitle").textContent = pageMeta[page][1];
    $("headActions").style.display = page === "calculator" ? "flex" : "none";

    if (page === "scenarios") renderScenarios();
    if (page === "vehicles") renderVehicles();
    if (page === "compare") renderCompare();
    if (page === "history") renderHistory();
    if (page === "energy") renderPrices();
    if (page === "account" && window.DriveCostAccount) window.DriveCostAccount.render();
    if (page === "calculation-details" && window.DriveCostProvenance) {
      window.DriveCostProvenance.renderCalculationDetails();
    }

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openSaveModal() {
    $("scenarioName").value = "";
    $("saveModal").classList.add("show");
    setTimeout(() => $("scenarioName").focus(), 30);
  }

  function closeSaveModal() {
    $("saveModal").classList.remove("show");
  }

  function saveScenario() {
    const name = $("scenarioName").value.trim();
    if (!name) {
      $("scenarioName").focus();
      return;
    }

    const result = core.calculate();
    const list = parse(storage.getItem(KEYS.scenarios), []);
    list.unshift({
      id: Date.now(),
      name,
      createdAt: new Date().toISOString(),
      data: core.snapshot(),
      result,
      priceSource: getPriceMetadata()[core.mode]
    });

    storage.setItem(KEYS.scenarios, JSON.stringify(list.slice(0, 30)));
    closeSaveModal();
    renderScenarios();
    toast("บันทึกสถานการณ์แล้ว");
  }

  function renderScenarios() {
    const root = $("scenarioList");
    const list = parse(storage.getItem(KEYS.scenarios), []);

    if (!list.length) {
      root.innerHTML = `
        <div class="empty-state">
          ยังไม่มีสถานการณ์ที่บันทึก
          <small>กลับไปหน้าเครื่องคำนวณ แล้วกด “บันทึกสถานการณ์”</small>
        </div>`;
      return;
    }

    root.innerHTML = list.map((item, index) => {
      const vehicleKey = item.data?.vehicle || "sedan";
      const vehicleName = core.vehicleData[vehicleKey]?.name || vehicleKey;
      const result = item.result || {};
      return `
        <article class="list-item">
          <div>
            <strong>${escapeHtml(item.name)}</strong>
            <span>${escapeHtml(vehicleName)} • ${fmt(result.totalDistance, 0)} กม. • ${fmt(result.total, 2)} บาท • ${escapeHtml(item.priceSource?.sourceName || "ไม่ระบุแหล่งราคา")}</span>
          </div>
          <div class="list-actions">
            <button type="button" class="mini-btn" data-load-scenario="${index}">เปิด</button>
            <button type="button" class="mini-btn danger" data-delete-scenario="${index}">ลบ</button>
          </div>
        </article>`;
    }).join("");

    root.querySelectorAll("[data-load-scenario]").forEach(button => {
      button.addEventListener("click", () => {
        core.applyData(list[Number(button.dataset.loadScenario)].data);
        showPage("calculator");
        toast("เปิดสถานการณ์แล้ว");
      });
    });

    root.querySelectorAll("[data-delete-scenario]").forEach(button => {
      button.addEventListener("click", () => {
        list.splice(Number(button.dataset.deleteScenario), 1);
        storage.setItem(KEYS.scenarios, JSON.stringify(list));
        renderScenarios();
        toast("ลบสถานการณ์แล้ว");
      });
    });
  }

  function renderVehicles() {
    Object.entries(core.vehicleData).forEach(([key, data]) => {
      const meta = document.getElementById(`fleetMeta-${key}`);
      if (meta) {
        const unit = data.defaultMode === "ev" ? "kWh/100 กม." : "กม./ลิตร";
        meta.textContent = `${data.eff} ${unit}`;
      }
    });

    document.querySelectorAll(".fleet-card").forEach(card => {
      card.classList.toggle("selected", card.dataset.fleet === core.vehicle);
    });
  }

  function recordHistory() {
    const result = core.calculate();
    const list = parse(storage.getItem(KEYS.history), []);
    list.unshift({
      ...result,
      vehicle: core.vehicle,
      priceSource: getPriceMetadata()[core.mode],
      createdAt: new Date().toISOString()
    });
    storage.setItem(KEYS.history, JSON.stringify(list.slice(0, 50)));
  }

  function renderHistory() {
    const root = $("historyList");
    const list = parse(storage.getItem(KEYS.history), []);

    if (!list.length) {
      root.innerHTML = '<div class="empty-state">ยังไม่มีประวัติการคำนวณ</div>';
      return;
    }

    root.innerHTML = list.map(item => {
      const vehicleName = core.vehicleData[item.vehicle]?.name || item.vehicle || "รถ";
      return `
        <article class="list-item">
          <div>
            <strong>${escapeHtml(vehicleName)} • ${fmt(item.total, 2)} บาท</strong>
            <span>${fmt(item.totalDistance, 0)} กม. • ${escapeHtml(item.energyType || "")} • ${escapeHtml(item.priceSource?.sourceName || "ไม่ระบุแหล่งราคา")} • ${new Date(item.createdAt).toLocaleString("th-TH")}</span>
          </div>
        </article>`;
    }).join("");
  }

  function getPrices() {
    const defaults = Object.fromEntries(
      Object.entries(core.energyData).map(([key, data]) => [key, Number(data.price)])
    );
    return Object.assign(defaults, parse(storage.getItem(KEYS.prices), {}));
  }

  function applyStoredPrices() {
    const prices = getPrices();
    Object.entries(prices).forEach(([key, value]) => {
      if (core.energyData[key]) core.energyData[key].price = Number(value);
    });
  }


  const sourceOptions = [
    ["system_sample", "ข้อมูลตัวอย่างของระบบ"],
    ["user", "ผู้ใช้กำหนดเอง"],
    ["receipt", "ใบเสร็จ / สถานีบริการ"],
    ["provider", "ผู้ให้บริการพลังงาน"],
    ["company", "ราคาของบริษัท / องค์กร"],
    ["external", "แหล่งข้อมูลภายนอก / API"]
  ];

  function getDefaultPriceMeta(key) {
    return {
      sourceType: "system_sample",
      sourceName: "DriveCost Sample Data",
      sourceUrl: "",
      note: "ข้อมูลตัวอย่างสำหรับการคำนวณ ไม่ใช่ราคาสด",
      updatedAt: null
    };
  }

  function getPriceMetadata() {
    const saved = parse(storage.getItem(KEYS.priceMeta), {});
    return Object.fromEntries(
      Object.keys(core.energyData).map(key => [
        key,
        Object.assign(getDefaultPriceMeta(key), saved[key] || {})
      ])
    );
  }

  function sourceOptionMarkup(selected) {
    return sourceOptions.map(([value, label]) =>
      `<option value="${value}" ${value === selected ? "selected" : ""}>${escapeHtml(label)}</option>`
    ).join("");
  }

  function renderPrices() {
    const prices = getPrices();
    const metadata = getPriceMetadata();

    $("priceGrid").innerHTML = Object.entries(core.energyData).map(([key, data]) => {
      const meta = metadata[key];
      const updated = meta.updatedAt
        ? new Date(meta.updatedAt).toLocaleString("th-TH")
        : "ยังไม่มีการแก้ไข";

      return `
        <article class="price-card provenance-card" data-price-card="${key}">
          <div class="price-card-head">
            <div>
              <strong>${escapeHtml(data.name || key.toUpperCase())}</strong>
              <p>${escapeHtml(data.priceUnit)}</p>
            </div>
            <span class="source-type-badge ${escapeHtml(meta.sourceType)}" data-source-badge="${key}">
              ${escapeHtml(sourceOptions.find(item => item[0] === meta.sourceType)?.[1] || "ไม่ระบุ")}
            </span>
          </div>

          <label class="provenance-label" for="price-${key}">ราคา</label>
          <div class="field-box">
            <input id="price-${key}" type="number" min="0" step=".01"
                   value="${prices[key]}" data-price-key="${key}">
          </div>

          <div class="provenance-fields">
            <div class="field">
              <label for="source-type-${key}">ประเภทแหล่งข้อมูล</label>
              <div class="field-box">
                <select id="source-type-${key}" data-source-type="${key}">
                  ${sourceOptionMarkup(meta.sourceType)}
                </select>
              </div>
            </div>

            <div class="field">
              <label for="source-name-${key}">ชื่อแหล่งข้อมูล</label>
              <div class="field-box">
                <input id="source-name-${key}" data-source-name="${key}"
                       value="${escapeHtml(meta.sourceName)}"
                       placeholder="เช่น ใบเสร็จสถานีบริการ หรือชื่อผู้ให้บริการ">
              </div>
            </div>

            <div class="field">
              <label for="source-url-${key}">ลิงก์อ้างอิง <span>ไม่บังคับ</span></label>
              <div class="field-box">
                <input id="source-url-${key}" data-source-url="${key}"
                       value="${escapeHtml(meta.sourceUrl || "")}"
                       placeholder="https://">
              </div>
            </div>

            <div class="field">
              <label for="source-note-${key}">หมายเหตุ</label>
              <div class="field-box">
                <input id="source-note-${key}" data-source-note="${key}"
                       value="${escapeHtml(meta.note || "")}"
                       placeholder="รายละเอียดเพิ่มเติม">
              </div>
            </div>
          </div>

          <div class="price-card-footer">
            <span>อัปเดตล่าสุด</span>
            <strong data-source-updated="${key}">${escapeHtml(updated)}</strong>
          </div>
        </article>`;
    }).join("");

    document.querySelectorAll("[data-source-type]").forEach(select => {
      select.addEventListener("change", () => {
        const key = select.dataset.sourceType;
        const badge = document.querySelector(`[data-source-badge="${key}"]`);
        const label = sourceOptions.find(item => item[0] === select.value)?.[1] || "ไม่ระบุ";
        badge.textContent = label;
        badge.className = `source-type-badge ${select.value}`;

        const nameInput = document.querySelector(`[data-source-name="${key}"]`);
        const noteInput = document.querySelector(`[data-source-note="${key}"]`);

        if (select.value === "system_sample") {
          if (!nameInput.value.trim()) nameInput.value = "DriveCost Sample Data";
          if (!noteInput.value.trim()) noteInput.value = "ข้อมูลตัวอย่างสำหรับการคำนวณ ไม่ใช่ราคาสด";
        } else if (select.value === "user" && !nameInput.value.trim()) {
          nameInput.value = "ผู้ใช้กำหนดเอง";
        }
      });
    });
  }

  function savePrices() {
    const prices = {};
    const existingMeta = getPriceMetadata();
    const metadata = {};
    const now = new Date().toISOString();

    document.querySelectorAll("[data-price-key]").forEach(input => {
      const key = input.dataset.priceKey;
      prices[key] = Math.max(0, Number.parseFloat(input.value) || 0);

      const sourceType = document.querySelector(`[data-source-type="${key}"]`)?.value || "user";
      const sourceName = document.querySelector(`[data-source-name="${key}"]`)?.value.trim() || (
        sourceType === "system_sample" ? "DriveCost Sample Data" : "ผู้ใช้กำหนดเอง"
      );
      const sourceUrl = document.querySelector(`[data-source-url="${key}"]`)?.value.trim() || "";
      const note = document.querySelector(`[data-source-note="${key}"]`)?.value.trim() || "";

      metadata[key] = {
        sourceType,
        sourceName,
        sourceUrl,
        note,
        updatedAt: now,
        previousUpdatedAt: existingMeta[key]?.updatedAt || null
      };
    });

    storage.setItem(KEYS.prices, JSON.stringify(prices));
    storage.setItem(KEYS.priceMeta, JSON.stringify(metadata));
    storage.setItem(KEYS.priceUpdated, now);

    applyStoredPrices();
    core.setMode(core.mode, false);
    renderPrices();

    window.dispatchEvent(new CustomEvent("drivecost:pricesourcechange", {
      detail: { mode: core.mode, metadata: metadata[core.mode] }
    }));

    toast("บันทึกราคาและแหล่งข้อมูลแล้ว");
  }

  function compareOne(vehicleKey, distance) {
    const car = core.vehicleData[vehicleKey];
    const energy = core.energyData[car.defaultMode];
    const price = getPrices()[car.defaultMode];
    const use = car.defaultMode === "ev"
      ? distance * (car.eff / 100)
      : distance / car.eff;

    return {
      cost: use * price,
      use,
      unit: car.defaultMode === "ev" ? "kWh" : "ลิตร",
      energyName: energy.name || car.defaultMode
    };
  }

  function ensureCompareOptions() {
    const options = Object.entries(core.vehicleData)
      .map(([key, data]) => `<option value="${key}">${escapeHtml(data.name)}</option>`)
      .join("");

    if (!$("compareA").options.length) {
      $("compareA").innerHTML = options;
      $("compareB").innerHTML = options;
      $("compareA").value = "sedan";
      $("compareB").value = "ev";
    }
  }

  function renderCompare() {
    ensureCompareOptions();

    const distance = Math.max(1, Number.parseFloat($("compareDistance").value) || 1);
    const keyA = $("compareA").value;
    const keyB = $("compareB").value;
    const resultA = compareOne(keyA, distance);
    const resultB = compareOne(keyB, distance);
    const maximum = Math.max(resultA.cost, resultB.cost, 1);

    [
      ["A", keyA, resultA],
      ["B", keyB, resultB]
    ].forEach(([suffix, key, result]) => {
      const car = core.vehicleData[key];
      $(`compareName${suffix}`).textContent = car.name;
      $(`compareImage${suffix}`).src = car.image;
      $(`compareDetail${suffix}`).textContent =
        `${fmt(result.use, 2)} ${result.unit} • ${result.energyName} • ${fmt(distance, 0)} กม.`;
      $(`compareCost${suffix}`).textContent = `${fmt(result.cost, 2)} บาท`;
      $(`compareBar${suffix}`).style.width = `${result.cost / maximum * 100}%`;
    });
  }

  function saveDraft() {
    if (!getSettings().autoDraft) return;
    storage.setItem(KEYS.draft, JSON.stringify(core.snapshot()));
  }

  function loadDraft() {
    const draft = parse(storage.getItem(KEYS.draft), null);
    if (draft) core.applyData(draft);
  }

  // Page navigation
  document.querySelectorAll(".nav-link, .mobile-nav [data-page]").forEach(button => {
    button.addEventListener("click", () => showPage(button.dataset.page));
  });
  document.querySelectorAll("[data-go-page]").forEach(button => {
    button.addEventListener("click", () => showPage(button.dataset.goPage));
  });

  // Intercept the old placeholder save behavior before its target listeners run.
  document.addEventListener("click", event => {
    const button = event.target.closest("#saveBtn,#saveTopBtn,#newScenarioBtn,#mobileSaveBtn");
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openSaveModal();
  }, true);

  $("cancelSaveBtn").addEventListener("click", closeSaveModal);
  $("confirmSaveBtn").addEventListener("click", saveScenario);
  $("scenarioName").addEventListener("keydown", event => {
    if (event.key === "Enter") saveScenario();
  });
  $("saveModal").addEventListener("click", event => {
    if (event.target === $("saveModal")) closeSaveModal();
  });

  // Vehicle page
  document.querySelectorAll(".use-vehicle").forEach(button => {
    button.addEventListener("click", () => {
      core.setVehicle(button.dataset.useVehicle);
      showPage("calculator");
      toast("เลือกรถแล้ว");
    });
  });

  // History and print
  $("calcBtn").addEventListener("click", recordHistory);
  $("clearHistoryBtn").addEventListener("click", async () => {
    if (!confirm("ล้างประวัติการคำนวณทั้งหมดของบัญชีนี้หรือไม่?")) return;

    // An explicit empty collection is a deletion marker. Removing the key
    // would look like "no local data" and allow older Cloud rows to return.
    storage.setItem(KEYS.history, "[]");
    renderHistory();
    toast("ล้างประวัติแล้ว");

    if (window.DriveCostAccount?.user) {
      await window.DriveCostAccount.syncNow("manual");
    }
  });
  $("printBtn").addEventListener("click", () => window.print());

  // Compare
  ["compareA", "compareB", "compareDistance"].forEach(id => {
    ["input", "change"].forEach(eventName => {
      $(id).addEventListener(eventName, renderCompare);
    });
  });

  // Prices
  $("savePricesBtn").addEventListener("click", savePrices);

  // Settings
  ["reduceMotion", "autoDraft"].forEach(id => {
    $(id).addEventListener("change", () => {
      const settings = {
        reduceMotion: $("reduceMotion").checked,
        autoDraft: $("autoDraft").checked
      };
      storage.setItem(KEYS.settings, JSON.stringify(settings));
      applySettings();
      toast("บันทึกการตั้งค่าแล้ว");
    });
  });

  $("resetDataBtn").addEventListener("click", async () => {
    if (!confirm("ล้างข้อมูล DriveCost ทั้งหมดของบัญชีนี้หรือไม่?")) return;

    // Store explicit reset values so the deletion is synchronized to Cloud.
    storage.setItem(KEYS.scenarios, "[]");
    storage.setItem(KEYS.history, "[]");
    storage.setItem(KEYS.prices, "{}");
    storage.setItem(KEYS.priceMeta, "{}");
    storage.setItem(KEYS.priceUpdated, "");
    storage.setItem(KEYS.settings, JSON.stringify({
      reduceMotion: false,
      autoDraft: true
    }));
    storage.setItem(KEYS.draft, "{}");

    window.DriveCostUI?.refresh?.();
    toast("ล้างข้อมูลแล้ว");

    if (window.DriveCostAccount?.user) {
      await window.DriveCostAccount.syncNow("manual");
    }

    setTimeout(() => location.reload(), 150);
  });

  // Draft autosave
  document.querySelectorAll("#page-calculator input,#page-calculator select").forEach(control => {
    ["input", "change"].forEach(eventName => {
      control.addEventListener(eventName, saveDraft);
    });
  });

  window.DriveCostPriceData = {
    getPrices,
    getPriceMetadata,
    renderPrices,
    get current() {
      return getPriceMetadata()[core.mode] || getDefaultPriceMeta(core.mode);
    }
  };

  window.DriveCostUI = {
    showPage,
    refresh() {
      applyStoredPrices();
      applySettings();
      renderScenarios();
      renderHistory();
      renderVehicles();
      renderPrices();
      renderCompare();
    },
    refreshDataLists() {
      applyStoredPrices();
      applySettings();
      renderScenarios();
      renderHistory();
      renderPrices();
      renderCompare();
    }
  };

  applyStoredPrices();
  applySettings();
  renderVehicles();
  renderPrices();
  ensureCompareOptions();
  renderCompare();
  loadDraft();
  showPage("calculator");
})();
