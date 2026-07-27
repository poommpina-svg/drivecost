
(() => {
  "use strict";

  const SECTION_KEYS = {
    scenarios: "drivecost-v2-scenarios",
    history: "drivecost-v2-history",
    prices: "drivecost-v2-prices",
    priceMeta: "drivecost-v2-price-metadata",
    priceUpdated: "drivecost-v2-price-updated",
    settings: "drivecost-v2-settings",
    draft: "drivecost-v2-draft",
    accessibility: "drivecost-v2.1-accessibility",
    livePriceSettings: "drivecost-live-price-settings-v1"
  };

  const KEY_TO_SECTION = Object.fromEntries(
    Object.entries(SECTION_KEYS).map(([section, key]) => [key, section])
  );
  const SYNC_KEYS = new Set(Object.values(SECTION_KEYS));

  const CONFIG_KEY = "drivecost-supabase-config-v1";
  const SECTION_META_KEY = "drivecost-sync-section-meta-v1";
  const DEVICE_KEY = "drivecost-sync-device-id-v1";
  const OWNER_KEY = "drivecost-sync-owner-user-id-v1";
  const LAST_SYNC_KEY = "drivecost-sync-last-success-v1";
  const DIRTY_KEY = "drivecost-sync-dirty-v1";
  const CHANGE_REV_KEY = "drivecost-sync-change-revision-v1";
  const DB_NAME = "drivecost-sync-v1";
  const QUEUE_RETIRED_KEY = "drivecost-sync-queue-retired-v1";
  const SYNC_DEBOUNCE_MS = 1400;

  let internalStorageWrite = false;
  let initialized = false;
  let client = null;
  let session = null;
  let currentUser = null;
  let profile = null;
  let realtimeChannel = null;
  let recoveryMode = false;
  let ownershipBlocked = false;
  let syncTimer = null;
  let syncing = false;
  let currentSyncState = "local";
  let currentSyncMessage = "ข้อมูลอยู่ในเครื่อง";
  let lastSyncedFingerprint = "";
  let lastSyncCompletedAt = 0;
  let focusSyncTimer = null;
  let localChangeRevision = Number(safeStorageGet(CHANGE_REV_KEY) || 0);
  let savedChangeRevision = localChangeRevision;
  let initializedSessionUserId = "";

  const nativeStorage = {
    getItem: Storage.prototype.getItem,
    setItem: Storage.prototype.setItem,
    removeItem: Storage.prototype.removeItem
  };

  function safeStorageGet(key) {
    try { return window.localStorage.getItem(key); }
    catch { return null; }
  }

  function safeStorageSet(key, value) {
    try {
      window.localStorage.setItem(key, String(value));
      return true;
    } catch {
      return false;
    }
  }

  function safeStorageRemove(key) {
    try {
      window.localStorage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  }

  function parse(value, fallback) {
    if (value === null || value === undefined || value === "") return fallback;
    try {
      const parsed = JSON.parse(value);
      return parsed === null ? fallback : parsed;
    } catch {
      return fallback;
    }
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function getSectionMeta() {
    return parse(safeStorageGet(SECTION_META_KEY), {});
  }

  function setSectionMeta(meta) {
    safeStorageSet(SECTION_META_KEY, JSON.stringify(meta));
  }

  function markSectionChanged(storageKey) {
    const section = KEY_TO_SECTION[storageKey];
    if (!section || internalStorageWrite) return;

    localChangeRevision += 1;
    safeStorageSet(CHANGE_REV_KEY, String(localChangeRevision));

    const meta = getSectionMeta();
    meta[section] = nowIso();
    setSectionMeta(meta);
    safeStorageSet(DIRTY_KEY, "1");

    window.dispatchEvent(new CustomEvent("drivecost:localdatachange", {
      detail: {
        section,
        storageKey,
        changedAt: meta[section],
        revision: localChangeRevision
      }
    }));
  }

  // Observe app writes without changing the behavior of localStorage.
  try {
    Storage.prototype.setItem = function patchedSetItem(key, value) {
      const stringKey = String(key);
      const stringValue = String(value);
      let previousValue = null;

      try {
        previousValue = nativeStorage.getItem.call(this, stringKey);
      } catch {}

      nativeStorage.setItem.call(this, stringKey, stringValue);

      try {
        if (
          this === window.localStorage &&
          SYNC_KEYS.has(stringKey) &&
          previousValue !== stringValue
        ) {
          markSectionChanged(stringKey);
        }
      } catch {}
    };

    Storage.prototype.removeItem = function patchedRemoveItem(key) {
      const stringKey = String(key);
      let previousValue = null;

      try {
        previousValue = nativeStorage.getItem.call(this, stringKey);
      } catch {}

      nativeStorage.removeItem.call(this, stringKey);

      try {
        if (
          this === window.localStorage &&
          SYNC_KEYS.has(stringKey) &&
          previousValue !== null
        ) {
          markSectionChanged(stringKey);
        }
      } catch {}
    };
  } catch {
    // Account sync can still be triggered manually when browser prototypes are locked.
  }

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    })[character]);
  }

  function initials(value) {
    const text = String(value || "?").trim();
    if (!text) return "?";
    const pieces = text.split(/\s+/).filter(Boolean);
    return pieces.slice(0, 2).map(piece => piece[0]).join("").toUpperCase();
  }

  function formatDate(value) {
    if (!value) return "ยังไม่เคย";
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "ไม่ทราบเวลา";
    return date.toLocaleString("th-TH", {
      dateStyle: "medium",
      timeStyle: "short"
    });
  }

  function setMessage(message, tone = "info") {
    const element = $("accountMessage");
    if (!element) return;
    if (!message) {
      element.hidden = true;
      element.textContent = "";
      element.className = "account-message";
      return;
    }
    element.hidden = false;
    element.textContent = message;
    element.className = `account-message ${tone === "info" ? "" : tone}`.trim();
  }

  function setBusy(form, busy, text = "กำลังดำเนินการ…") {
    if (!form) return;
    form.querySelectorAll("button,input").forEach(element => {
      element.disabled = Boolean(busy);
    });
    const button = form.querySelector('button[type="submit"]');
    if (!button) return;
    if (busy) {
      button.dataset.originalText = button.textContent;
      button.textContent = text;
    } else if (button.dataset.originalText) {
      button.textContent = button.dataset.originalText;
      delete button.dataset.originalText;
    }
  }

  function readJwtRole(key) {
    const parts = String(key || "").split(".");
    if (parts.length !== 3) return "";
    try {
      const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
      return JSON.parse(atob(padded)).role || "";
    } catch {
      return "";
    }
  }

  function validateConfig(config) {
    const url = String(config?.url || "").trim().replace(/\/+$/, "");
    const publishableKey = String(config?.publishableKey || "").trim();

    if (!url || !publishableKey) {
      return { ok: false, message: "กรอก Project URL และ Publishable key ให้ครบ" };
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      return { ok: false, message: "Project URL ไม่ถูกต้อง" };
    }

    if (parsedUrl.protocol !== "https:" && parsedUrl.hostname !== "localhost" && parsedUrl.hostname !== "127.0.0.1") {
      return { ok: false, message: "Project URL ต้องใช้ HTTPS" };
    }

    if (/sb_secret_|service[_-]?role/i.test(publishableKey) || readJwtRole(publishableKey) === "service_role") {
      return {
        ok: false,
        message: "ห้ามใช้ Secret หรือ Service Role key ในหน้าเว็บ ให้ใช้ Publishable key หรือ legacy anon key เท่านั้น"
      };
    }

    if (publishableKey.length < 30) {
      return { ok: false, message: "Publishable key สั้นกว่ารูปแบบที่คาดไว้" };
    }

    return {
      ok: true,
      config: { url, publishableKey }
    };
  }

  function loadConfig() {
    const saved = parse(safeStorageGet(CONFIG_KEY), null);
    const fileConfig = window.DRIVECOST_SUPABASE_CONFIG || {};
    const candidate = saved?.url && saved?.publishableKey ? saved : fileConfig;
    const validation = validateConfig(candidate);
    return validation.ok ? validation.config : null;
  }

  function saveConfig(config) {
    safeStorageSet(CONFIG_KEY, JSON.stringify(config));
  }

  function getDeviceId() {
    let deviceId = safeStorageGet(DEVICE_KEY);
    if (!deviceId) {
      const random = crypto.randomUUID ? crypto.randomUUID() :
        `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      deviceId = `web-${random}`;
      safeStorageSet(DEVICE_KEY, deviceId);
    }
    return deviceId;
  }

  async function retireLegacyQueue() {
    safeStorageRemove("drivecost-sync-pending-fallback-v1");

    if (safeStorageGet(QUEUE_RETIRED_KEY) === "1") {
      await updatePendingCount();
      return;
    }

    try {
      if ("indexedDB" in window) {
        await new Promise(resolve => {
          const request = indexedDB.deleteDatabase(DB_NAME);
          request.onsuccess = resolve;
          request.onerror = resolve;
          request.onblocked = resolve;
        });
      }
    } catch {}

    safeStorageSet(QUEUE_RETIRED_KEY, "1");
    await updatePendingCount();
  }

  async function updatePendingCount() {
    const value = $("pendingSyncValue");
    const label = $("pendingSyncLabel");
    const offlineStatus = $("offlineSaveStatus");

    if (value) value.textContent = "0";
    if (label) {
      label.textContent = navigator.onLine
        ? "บันทึกเข้าบัญชีโดยตรง"
        : "เก็บข้อมูลไว้ในเครื่อง";
    }
    if (offlineStatus) {
      offlineStatus.textContent = navigator.onLine
        ? "พร้อมใช้งาน"
        : "กำลังออฟไลน์";
    }
  }

  async function hasPendingWork() {
    return safeStorageGet(DIRTY_KEY) === "1";
  }

  function decodeSection(storageKey) {
    const raw = safeStorageGet(storageKey);
    if (raw === null) return { encoding: "missing", value: null };

    try {
      return { encoding: "json", value: JSON.parse(raw) };
    } catch {
      return { encoding: "text", value: raw };
    }
  }

  function isMeaningfulSection(sectionName, section) {
    if (!section || section.encoding === "missing") return false;
    const value = section.value;

    if (sectionName === "scenarios" || sectionName === "history") {
      return Array.isArray(value) && value.length > 0;
    }
    if (sectionName === "prices") {
      return value && typeof value === "object" && Object.keys(value).length > 0;
    }
    if (sectionName === "priceMeta") {
      return value && typeof value === "object" &&
        Object.values(value).some(item => item?.sourceType && item.sourceType !== "system_sample");
    }
    if (sectionName === "draft") {
      return value && typeof value === "object" &&
        (String(value.distance || "") !== "250" || value.vehicle !== "sedan" || value.mode !== "fuel");
    }
    return true;
  }

  function buildLocalPayload() {
    const sectionUpdatedAt = getSectionMeta();
    const sections = {};
    const currentTime = nowIso();

    for (const [sectionName, storageKey] of Object.entries(SECTION_KEYS)) {
      const section = decodeSection(storageKey);
      sections[sectionName] = section;
      if (!sectionUpdatedAt[sectionName] && isMeaningfulSection(sectionName, section)) {
        sectionUpdatedAt[sectionName] = currentTime;
      }
    }

    setSectionMeta(sectionUpdatedAt);

    return {
      schemaVersion: 1,
      updatedAt: currentTime,
      deviceId: getDeviceId(),
      sections,
      sectionUpdatedAt
    };
  }

  function normalizePayload(payload) {
    const normalized = payload && typeof payload === "object" ? payload : {};
    return {
      schemaVersion: Number(normalized.schemaVersion || 1),
      updatedAt: normalized.updatedAt || "1970-01-01T00:00:00.000Z",
      deviceId: normalized.deviceId || "",
      sections: normalized.sections && typeof normalized.sections === "object" ? normalized.sections : {},
      sectionUpdatedAt: normalized.sectionUpdatedAt && typeof normalized.sectionUpdatedAt === "object"
        ? normalized.sectionUpdatedAt : {}
    };
  }

  function timestampValue(value) {
    const time = Date.parse(value || "");
    return Number.isFinite(time) ? time : 0;
  }

  function entryFingerprint(item, sectionName) {
    if (item?.id !== undefined && item?.id !== null) return String(item.id);
    if (sectionName === "history") {
      return [
        item?.createdAt || "",
        item?.vehicle || "",
        item?.energyType || "",
        item?.total || ""
      ].join("|");
    }
    return [item?.createdAt || "", item?.name || "", item?.data?.vehicle || ""].join("|");
  }

  function mergeArraySection(localSection, remoteSection, sectionName) {
    const localItems = localSection?.encoding === "json" && Array.isArray(localSection.value)
      ? localSection.value : [];
    const remoteItems = remoteSection?.encoding === "json" && Array.isArray(remoteSection.value)
      ? remoteSection.value : [];

    const map = new Map();
    for (const item of [...remoteItems, ...localItems]) {
      const key = entryFingerprint(item, sectionName);
      const existing = map.get(key);
      const itemTime = timestampValue(item?.updatedAt || item?.createdAt);
      const existingTime = timestampValue(existing?.updatedAt || existing?.createdAt);
      if (!existing || itemTime >= existingTime) map.set(key, item);
    }

    const limit = sectionName === "history" ? 50 : 30;
    const merged = [...map.values()]
      .sort((a, b) => timestampValue(b?.updatedAt || b?.createdAt) - timestampValue(a?.updatedAt || a?.createdAt))
      .slice(0, limit);

    return { encoding: "json", value: merged };
  }


  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (value && typeof value === "object") {
      return Object.keys(value).sort().reduce((result, key) => {
        result[key] = stableValue(value[key]);
        return result;
      }, {});
    }
    return value;
  }

  function payloadFingerprint(payload) {
    const normalized = normalizePayload(payload);
    return JSON.stringify(stableValue({
      schemaVersion: normalized.schemaVersion,
      sections: normalized.sections,
      sectionUpdatedAt: normalized.sectionUpdatedAt
    }));
  }

  function mergePayloads(localPayload, remotePayload) {
    const local = normalizePayload(localPayload);
    const remote = normalizePayload(remotePayload);
    const merged = {
      schemaVersion: Math.max(local.schemaVersion, remote.schemaVersion, 1),
      updatedAt: nowIso(),
      deviceId: getDeviceId(),
      sections: {},
      sectionUpdatedAt: {}
    };

    for (const sectionName of Object.keys(SECTION_KEYS)) {
      const localSection = local.sections[sectionName];
      const remoteSection = remote.sections[sectionName];
      const localTime = timestampValue(local.sectionUpdatedAt[sectionName]);
      const remoteTime = timestampValue(remote.sectionUpdatedAt[sectionName]);

      if (sectionName === "scenarios" || sectionName === "history") {
        const localExists = localSection && localSection.encoding !== "missing";
        const remoteExists = remoteSection && remoteSection.encoding !== "missing";

        if (!localExists && remoteExists) {
          merged.sections[sectionName] = remoteSection;
          merged.sectionUpdatedAt[sectionName] = remote.sectionUpdatedAt[sectionName] || "";
        } else if (localExists && !remoteExists) {
          merged.sections[sectionName] = localSection;
          merged.sectionUpdatedAt[sectionName] = local.sectionUpdatedAt[sectionName] || "";
        } else if (localTime > remoteTime) {
          // The local collection changed last. This includes clearing the
          // collection or deleting an item, so do not merge old remote rows back.
          merged.sections[sectionName] = localSection || { encoding: "json", value: [] };
          merged.sectionUpdatedAt[sectionName] = local.sectionUpdatedAt[sectionName] || "";
        } else if (remoteTime > localTime) {
          // A newer clear/delete from another device must also remain deleted.
          merged.sections[sectionName] = remoteSection || { encoding: "json", value: [] };
          merged.sectionUpdatedAt[sectionName] = remote.sectionUpdatedAt[sectionName] || "";
        } else if (localExists || remoteExists) {
          // Equal or missing timestamps are treated as legacy data and merged once.
          merged.sections[sectionName] = mergeArraySection(localSection, remoteSection, sectionName);
          const latestSectionTime = Math.max(localTime, remoteTime);
          merged.sectionUpdatedAt[sectionName] = latestSectionTime
            ? new Date(latestSectionTime).toISOString()
            : "";
        } else {
          merged.sections[sectionName] = { encoding: "missing", value: null };
          merged.sectionUpdatedAt[sectionName] = "";
        }
        continue;
      }

      if (!localSection) {
        merged.sections[sectionName] = remoteSection || { encoding: "missing", value: null };
        merged.sectionUpdatedAt[sectionName] = remote.sectionUpdatedAt[sectionName] || "";
      } else if (!remoteSection) {
        merged.sections[sectionName] = localSection;
        merged.sectionUpdatedAt[sectionName] = local.sectionUpdatedAt[sectionName] || "";
      } else if (remoteTime > localTime) {
        merged.sections[sectionName] = remoteSection;
        merged.sectionUpdatedAt[sectionName] = remote.sectionUpdatedAt[sectionName] || "";
      } else {
        merged.sections[sectionName] = localSection;
        merged.sectionUpdatedAt[sectionName] = local.sectionUpdatedAt[sectionName] || "";
      }
    }

    return merged;
  }

  function sectionRawValue(section) {
    if (!section || section.encoding === "missing") return null;
    if (section.encoding === "text") return String(section.value ?? "");
    return JSON.stringify(section.value);
  }

  function applyPayloadToLocal(payload) {
    const normalized = normalizePayload(payload);
    internalStorageWrite = true;

    try {
      for (const [sectionName, storageKey] of Object.entries(SECTION_KEYS)) {
        const section = normalized.sections[sectionName];
        const raw = sectionRawValue(section);
        if (raw === null) {
          safeStorageRemove(storageKey);
        } else {
          safeStorageSet(storageKey, raw);
        }
      }
      setSectionMeta(normalized.sectionUpdatedAt);
      safeStorageRemove(DIRTY_KEY);

      const draft = normalized.sections.draft;
      const currentDraft = window.DriveCostCore?.snapshot?.();
      const incomingDraft = draft?.encoding === "json" ? draft.value : null;
      const draftChanged = incomingDraft && JSON.stringify(incomingDraft) !== JSON.stringify(currentDraft || {});

      if (draftChanged && window.DriveCostCore?.applyData) {
        window.DriveCostCore.applyData(incomingDraft);
      }

      window.DriveCostUI?.refreshDataLists?.();
      window.dispatchEvent(new CustomEvent("drivecost:cloudapplied", {
        detail: { payload: normalized, draftChanged }
      }));
    } finally {
      // Keep suppression active through synchronous UI refreshes.
      queueMicrotask(() => {
        internalStorageWrite = false;
      });
    }
  }

  function hasMeaningfulLocalData() {
    const payload = buildLocalPayload();
    return Object.entries(payload.sections).some(([sectionName, section]) =>
      isMeaningfulSection(sectionName, section)
    );
  }

  function setSyncStatus(state, label, detail = "") {
    currentSyncState = state;
    currentSyncMessage = label;

    const indicatorClass = `sync-indicator ${state}`;
    for (const id of ["accountChipIndicator", "accountPageIndicator"]) {
      if ($(id)) $(id).className = indicatorClass;
    }

    if ($("accountChipStatus")) $("accountChipStatus").textContent = label;
    if ($("accountPageStatus")) $("accountPageStatus").textContent = label;
    if ($("accountPageStatusDetail")) $("accountPageStatusDetail").textContent = detail || "—";
    if ($("syncDashboardStatus")) $("syncDashboardStatus").textContent = label;
    if ($("syncDashboardMessage")) $("syncDashboardMessage").textContent = detail || "—";
  }

  function showOnlyState(stateId) {
    for (const id of [
      "accountSetupState",
      "accountSignedOutState",
      "accountRecoveryState",
      "accountSignedInState"
    ]) {
      const element = $(id);
      if (element) element.hidden = id !== stateId;
    }
  }

  function renderIdentity() {
    const name = profile?.display_name ||
      currentUser?.user_metadata?.display_name ||
      currentUser?.email?.split("@")[0] ||
      "ผู้ใช้ DriveCost";
    const email = currentUser?.email || "—";
    const avatarText = initials(name);

    if ($("accountChipAvatar")) $("accountChipAvatar").textContent = currentUser ? avatarText : "?";
    if ($("accountChipLabel")) $("accountChipLabel").textContent = currentUser ? name : "ยังไม่เข้าสู่ระบบ";
    if ($("accountProfileAvatar")) $("accountProfileAvatar").textContent = avatarText;
    if ($("accountDisplayName")) $("accountDisplayName").textContent = name;
    if ($("accountEmail")) $("accountEmail").textContent = email;
    if ($("profileDisplayName")) $("profileDisplayName").value = profile?.display_name || name;
    if ($("accountDataScope")) {
      $("accountDataScope").textContent = currentUser
        ? `แยกเฉพาะ ${email}`
        : "พื้นที่ Guest";
    }
  }

  function renderOwnershipWarning() {
    const warning = $("accountOwnershipWarning");
    if (warning) warning.hidden = !ownershipBlocked;
  }

  function render() {
    const config = loadConfig();
    renderIdentity();
    renderOwnershipWarning();

    if (!config || !client) {
      showOnlyState("accountSetupState");
      setSyncStatus("local", "ระบบบัญชียังไม่พร้อม", "ผู้ดูแลแอพยังไม่ได้เปิดการบันทึกด้วยบัญชี");
      const saved = parse(safeStorageGet(CONFIG_KEY), null);
      if ($("supabaseProjectUrl")) $("supabaseProjectUrl").value = saved?.url || window.DRIVECOST_SUPABASE_CONFIG?.url || "";
      if ($("supabasePublishableKey")) $("supabasePublishableKey").value = saved?.publishableKey || "";
      return;
    }

    if (recoveryMode) {
      showOnlyState("accountRecoveryState");
      setSyncStatus("syncing", "กำลังกู้คืนบัญชี", "ตั้งรหัสผ่านใหม่เพื่อดำเนินการต่อ");
      return;
    }

    if (!currentUser) {
      showOnlyState("accountSignedOutState");
      setSyncStatus("local", "ยังไม่เข้าสู่ระบบ", "เข้าสู่ระบบเพื่อบันทึกข้อมูลในบัญชี");
      return;
    }

    showOnlyState("accountSignedInState");
    if ($("lastSyncValue")) $("lastSyncValue").textContent = formatDate(safeStorageGet(LAST_SYNC_KEY));
    if ($("deviceIdValue")) $("deviceIdValue").textContent = getDeviceId().slice(-12);
    updatePendingCount();

    if (ownershipBlocked) {
      setSyncStatus("blocked", "รอเลือกข้อมูล", "พบข้อมูลจากบัญชีอื่นในอุปกรณ์นี้");
    } else if (!navigator.onLine) {
      setSyncStatus("offline", "ออฟไลน์ • เก็บไว้ในเครื่อง", "ระบบจะบันทึกเข้าบัญชีเมื่อกลับมาออนไลน์");
    } else if (!syncing && currentSyncState === "local") {
      setSyncStatus("synced", "บันทึกแล้ว", "ระบบบันทึกข้อมูลให้อัตโนมัติ");
    }
  }

  async function createSupabaseClient() {
    const config = loadConfig();
    if (!config || !window.supabase?.createClient) {
      client = null;
      return null;
    }

    const hostKey = new URL(config.url).hostname.replace(/[^a-z0-9]/gi, "-");
    client = window.supabase.createClient(config.url, config.publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: `drivecost-auth-${hostKey}`
      }
    });
    return client;
  }

  async function loadProfile() {
    if (!client || !currentUser) {
      profile = null;
      return;
    }

    const { data, error } = await client
      .from("profiles")
      .select("display_name, avatar_url")
      .eq("id", currentUser.id)
      .maybeSingle();

    if (error) {
      setMessage(`อ่านโปรไฟล์ไม่สำเร็จ: ${error.message}`, "warning");
      profile = {
        display_name: currentUser.user_metadata?.display_name || null,
        avatar_url: null
      };
      return;
    }

    profile = data || {
      display_name: currentUser.user_metadata?.display_name || null,
      avatar_url: null
    };
  }

  function checkOwnership() {
    // Local data is already isolated by the active account namespace.
    ownershipBlocked = false;
    if (currentUser) safeStorageSet(OWNER_KEY, currentUser.id);
  }

  async function fetchServerState() {
    const { data, error } = await client
      .from("user_sync_state")
      .select("payload, revision, updated_at, device_id")
      .eq("user_id", currentUser.id)
      .maybeSingle();

    if (error) {
      const message = /relation .*user_sync_state.* does not exist|permission denied|Could not find the table/i.test(error.message)
        ? "ยังไม่ได้รัน supabase/schema.sql หรือ RLS/สิทธิ์ยังไม่พร้อม"
        : error.message;
      throw new Error(message);
    }

    return data || null;
  }

  async function saveServerState(expectedRevision, payload) {
    const { data, error } = await client.rpc("save_user_sync_state", {
      p_expected_revision: Number(expectedRevision || 0),
      p_payload: payload,
      p_client_updated_at: payload.updatedAt || nowIso(),
      p_device_id: getDeviceId()
    });

    if (error) {
      const message = /Could not find the function|permission denied/i.test(error.message)
        ? "ยังไม่ได้รันฟังก์ชัน save_user_sync_state จาก supabase/schema.sql"
        : error.message;
      throw new Error(message);
    }

    return data;
  }

  async function syncNow(reason = "manual") {
    if (!client || !currentUser || syncing) return;
    if (ownershipBlocked) {
      setMessage("ยืนยันวิธีจัดการข้อมูลต่างบัญชีก่อนเริ่มบันทึก", "warning");
      render();
      return;
    }

    const isInitialCheck = reason === "signin" || reason === "initial";
    const isManual = reason === "manual";

    if (!isInitialCheck && !isManual && !(await hasPendingWork())) {
      return;
    }

    const revisionAtStart = localChangeRevision;
    const localPayload = buildLocalPayload();

    if (!navigator.onLine) {
      safeStorageSet(DIRTY_KEY, "1");
      await updatePendingCount();
      setSyncStatus("offline", "ออฟไลน์ • เก็บไว้ในเครื่อง", "ระบบจะบันทึกเข้าบัญชีเมื่อกลับมาออนไลน์");
      return;
    }

    syncing = true;
    if (isInitialCheck || isManual) {
      setSyncStatus("syncing", "กำลังตรวจข้อมูล", "กำลังตรวจสอบข้อมูลในบัญชี");
    }
    setMessage("");

    try {
      let serverState = await fetchServerState();
      let merged = serverState
        ? mergePayloads(localPayload, serverState.payload)
        : localPayload;

      const mergedFingerprint = payloadFingerprint(merged);
      const serverFingerprint = serverState?.payload
        ? payloadFingerprint(serverState.payload)
        : "";

      if (serverState && mergedFingerprint === serverFingerprint) {
        safeStorageSet(OWNER_KEY, currentUser.id);
        safeStorageSet(LAST_SYNC_KEY, nowIso());
        if (localChangeRevision === revisionAtStart) {
          safeStorageRemove(DIRTY_KEY);
          savedChangeRevision = revisionAtStart;
        }
        lastSyncedFingerprint = serverFingerprint;
        lastSyncCompletedAt = Date.now();
        await updatePendingCount();
        setSyncStatus("synced", "บันทึกแล้ว", "ข้อมูลล่าสุดอยู่ในบัญชีของคุณ");
        setMessage("");
        return;
      }

      let result = await saveServerState(serverState?.revision || 0, merged);

      if (!result?.saved) {
        merged = mergePayloads(merged, result?.payload || {});
        result = await saveServerState(result?.revision || 0, merged);
      }

      if (!result?.saved) {
        throw new Error("ข้อมูลถูกแก้จากอุปกรณ์อื่นพร้อมกัน กรุณากดซิงก์อีกครั้ง");
      }

      const savedPayload = result.payload || merged;
      const localFingerprintBeforeSave = payloadFingerprint(localPayload);
      const savedFingerprint = payloadFingerprint(savedPayload);

      if (savedFingerprint !== localFingerprintBeforeSave) {
        applyPayloadToLocal(savedPayload);
      }

      safeStorageSet(OWNER_KEY, currentUser.id);
      safeStorageSet(LAST_SYNC_KEY, nowIso());
      lastSyncedFingerprint = payloadFingerprint(savedPayload);
      lastSyncCompletedAt = Date.now();

      if (localChangeRevision === revisionAtStart) {
        savedChangeRevision = revisionAtStart;
        safeStorageRemove(DIRTY_KEY);
      } else {
        safeStorageSet(DIRTY_KEY, "1");
      }
      await updatePendingCount();

      setSyncStatus("synced", "บันทึกแล้ว", "ข้อมูลล่าสุดอยู่ในบัญชีของคุณ");
      if (isManual) setMessage("บันทึกข้อมูลสำเร็จ");

      if (localChangeRevision > revisionAtStart) {
        clearTimeout(syncTimer);
        syncTimer = setTimeout(() => syncNow("local-change"), SYNC_DEBOUNCE_MS);
      }
    } catch (error) {
      safeStorageSet(DIRTY_KEY, "1");
      await updatePendingCount();
      if (navigator.onLine) {
        setSyncStatus("error", "บันทึกไม่สำเร็จ", error.message);
        setMessage(`บันทึกข้อมูลไม่สำเร็จ: ${error.message}`, "error");
      } else {
        setSyncStatus("offline", "ออฟไลน์ • เก็บไว้ในเครื่อง", "ระบบจะบันทึกเข้าบัญชีเมื่อกลับมาออนไลน์");
      }
    } finally {
      syncing = false;
      render();
    }
  }

  async function forceUploadLocal() {
    if (!client || !currentUser || ownershipBlocked) return;
    if (!confirm("ใช้ข้อมูลในเครื่องแทนข้อมูล Cloud ของบัญชีนี้หรือไม่? ข้อมูล Cloud เดิมอาจถูกแทนที่")) return;

    syncing = true;
    setSyncStatus("syncing", "กำลังส่งข้อมูล", "ใช้ข้อมูลในเครื่องเป็นต้นฉบับ");
    try {
      const serverState = await fetchServerState();
      const localPayload = buildLocalPayload();
      let result = await saveServerState(serverState?.revision || 0, localPayload);
      if (!result?.saved) {
        result = await saveServerState(result?.revision || 0, localPayload);
      }
      if (!result?.saved) throw new Error("Cloud ถูกแก้พร้อมกัน กรุณาลองใหม่");

      applyPayloadToLocal(result.payload || localPayload);
      safeStorageSet(LAST_SYNC_KEY, nowIso());
      safeStorageRemove(DIRTY_KEY);
      await updatePendingCount();
      setMessage("บันทึกข้อมูลจากอุปกรณ์นี้เข้าบัญชีแล้ว");
      setSyncStatus("synced", "บันทึกแล้ว", "บัญชีใช้ข้อมูลล่าสุดจากอุปกรณ์นี้");
    } catch (error) {
      setMessage(`ส่งข้อมูลไม่สำเร็จ: ${error.message}`, "error");
      setSyncStatus("error", "ส่งข้อมูลไม่สำเร็จ", error.message);
    } finally {
      syncing = false;
      render();
    }
  }

  async function forceDownloadCloud(options = {}) {
    if (!client || !currentUser) return;
    if (!options.skipConfirm && !confirm("ใช้ข้อมูล Cloud แทนส่วนข้อมูลที่ซิงก์ได้ในเครื่องหรือไม่?")) return;

    syncing = true;
    setSyncStatus("syncing", "กำลังดึงข้อมูล", "อ่านข้อมูลจาก Cloud");
    try {
      const serverState = await fetchServerState();
      if (!serverState?.payload) throw new Error("บัญชีนี้ยังไม่มีข้อมูลบน Cloud");

      applyPayloadToLocal(serverState.payload);
      safeStorageSet(OWNER_KEY, currentUser.id);
      safeStorageSet(LAST_SYNC_KEY, nowIso());
      ownershipBlocked = false;
      safeStorageRemove(DIRTY_KEY);
      await updatePendingCount();

      setMessage("โหลดข้อมูลจากบัญชีแล้ว");
      setSyncStatus("synced", "บันทึกแล้ว", "โหลดข้อมูลบัญชีลงในอุปกรณ์นี้แล้ว");
    } catch (error) {
      setMessage(`ดึงข้อมูลไม่สำเร็จ: ${error.message}`, "error");
      setSyncStatus("error", "ดึงข้อมูลไม่สำเร็จ", error.message);
    } finally {
      syncing = false;
      render();
    }
  }

  async function subscribeRealtime() {
    // Realtime is intentionally not used as a write trigger.
    // Some Supabase configurations echo the device's own update without
    // exposing device_id reliably, which can create an endless save loop.
    if (realtimeChannel && client) {
      await client.removeChannel(realtimeChannel).catch(() => {});
    }
    realtimeChannel = null;
  }

  async function handleSession(nextSession, event = "INITIAL_SESSION") {
    session = nextSession || null;
    currentUser = session?.user || null;

    const scopedStorage = window.DriveCostScopedStorage;
    const expectedScope = currentUser ? `user:${currentUser.id}` : "guest";

    if (scopedStorage && scopedStorage.namespace !== expectedScope) {
      if (currentUser) scopedStorage.activateUser(currentUser.id);
      else scopedStorage.activateGuest();
      return;
    }

    if (!currentUser) {
      scopedStorage?.finalizeGuestMigration?.();
      profile = null;
      ownershipBlocked = false;
      if (realtimeChannel && client) {
        await client.removeChannel(realtimeChannel).catch(() => {});
        realtimeChannel = null;
      }
      render();
      return;
    }

    try {
      const { data, error } = await client.auth.getUser();
      if (!error && data?.user) currentUser = data.user;
    } catch {}

    await loadProfile();
    checkOwnership();
    render();

    const firstSessionForUser = initializedSessionUserId !== currentUser.id;
    initializedSessionUserId = currentUser.id;

    if (
      firstSessionForUser &&
      !ownershipBlocked &&
      navigator.onLine &&
      event !== "TOKEN_REFRESHED"
    ) {
      await subscribeRealtime();
      await syncNow(event === "SIGNED_IN" ? "signin" : "initial");
    }
  }

  function scheduleLocalSync() {
    if (!initialized || !currentUser || ownershipBlocked || internalStorageWrite) return;
    if (localChangeRevision <= savedChangeRevision) return;

    const payload = buildLocalPayload();
    const fingerprint = payloadFingerprint(payload);
    if (fingerprint === lastSyncedFingerprint) {
      savedChangeRevision = localChangeRevision;
      safeStorageRemove(DIRTY_KEY);
      return;
    }

    clearTimeout(syncTimer);

    if (!navigator.onLine) {
      safeStorageSet(DIRTY_KEY, "1");
      void updatePendingCount();
      setSyncStatus("offline", "ออฟไลน์ • เก็บไว้ในเครื่อง", "ระบบจะบันทึกเข้าบัญชีเมื่อกลับมาออนไลน์");
      return;
    }

    syncTimer = setTimeout(() => syncNow("local-change"), SYNC_DEBOUNCE_MS);
  }

  async function clearLocalSyncedData() {
    if (!confirm("ล้างสถานการณ์ ประวัติ ราคา การตั้งค่า และร่างคำนวณออกจากอุปกรณ์นี้หรือไม่? ข้อมูล Cloud จะยังอยู่")) return;

    internalStorageWrite = true;
    try {
      Object.values(SECTION_KEYS).forEach(safeStorageRemove);
      safeStorageRemove(SECTION_META_KEY);
      safeStorageRemove(DIRTY_KEY);
    } finally {
      internalStorageWrite = false;
    }
    safeStorageRemove("drivecost-sync-pending-fallback-v1");
    await retireLegacyQueue();
    window.DriveCostUI?.refresh?.();
    setMessage("ล้างข้อมูล DriveCost ในเครื่องแล้ว");
    location.reload();
  }

  async function testSupabaseEndpoint(config) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      // New sb_publishable_ keys are API keys, not JWTs.
      // Send them only through the apikey header during this connection test.
      const response = await fetch(`${config.url}/auth/v1/health`, {
        method: "GET",
        headers: {
          apikey: config.publishableKey,
          Accept: "application/json"
        },
        signal: controller.signal
      });

      if (response.status === 401 || response.status === 403) {
        throw new Error("Publishable key ไม่ตรงกับ Supabase Project นี้");
      }
      if (response.status === 404) {
        throw new Error("Project URL ไม่ถูกต้อง หรือโปรเจกต์ยังสร้างไม่เสร็จ");
      }
      if (!response.ok) {
        throw new Error(`Supabase ตอบกลับ HTTP ${response.status}`);
      }
      return true;
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error("Supabase ตอบกลับช้าเกินไป กรุณาลองใหม่");
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  function selectAuthTab(tabName) {
    document.querySelectorAll("[data-auth-tab]").forEach(button => {
      const active = button.dataset.authTab === tabName;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
    document.querySelectorAll("[data-auth-panel]").forEach(panel => {
      const active = panel.dataset.authPanel === tabName;
      panel.hidden = !active;
      panel.classList.toggle("active", active);
    });
    setMessage("");
  }

  function bindEvents() {
    window.addEventListener("drivecost:localdatachange", scheduleLocalSync);
    window.addEventListener("online", async () => {
      if (currentUser && !ownershipBlocked && await hasPendingWork()) {
        syncNow("online");
      }
      render();
    });
    window.addEventListener("offline", render);

    document.querySelectorAll("[data-auth-tab]").forEach(button => {
      button.addEventListener("click", () => selectAuthTab(button.dataset.authTab));
    });

    $("supabaseSetupForm")?.addEventListener("submit", async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const validation = validateConfig({
        url: $("supabaseProjectUrl").value,
        publishableKey: $("supabasePublishableKey").value
      });

      if (!validation.ok) {
        setMessage(validation.message, "error");
        return;
      }

      setBusy(form, true, "กำลังตรวจสอบ…");
      setMessage("");
      try {
        await testSupabaseEndpoint(validation.config);
        saveConfig(validation.config);
        setMessage("เชื่อม Supabase สำเร็จ กำลังเปิดระบบบัญชี");
        setTimeout(() => location.reload(), 450);
      } catch (error) {
        setMessage(`เชื่อมต่อไม่สำเร็จ: ${error.message}`, "error");
      } finally {
        setBusy(form, false);
      }
    });

    $("signInForm")?.addEventListener("submit", async event => {
      event.preventDefault();
      const form = event.currentTarget;
      setBusy(form, true, "กำลังเข้าสู่ระบบ…");
      setMessage("");
      try {
        const { error } = await client.auth.signInWithPassword({
          email: $("signInEmail").value.trim(),
          password: $("signInPassword").value
        });
        if (error) throw error;
        setMessage("เข้าสู่ระบบสำเร็จ กำลังตรวจข้อมูลสำหรับซิงก์");
      } catch (error) {
        setMessage(`เข้าสู่ระบบไม่สำเร็จ: ${error.message}`, "error");
      } finally {
        setBusy(form, false);
      }
    });

    $("signUpForm")?.addEventListener("submit", async event => {
      event.preventDefault();
      const form = event.currentTarget;
      setBusy(form, true, "กำลังสร้างบัญชี…");
      setMessage("");
      try {
        const { data, error } = await client.auth.signUp({
          email: $("signUpEmail").value.trim(),
          password: $("signUpPassword").value,
          options: {
            data: { display_name: $("signUpName").value.trim() }
          }
        });
        if (error) throw error;

        if (data.session) {
          setMessage("สมัครสมาชิกสำเร็จ และเข้าสู่ระบบแล้ว");
        } else {
          $("signInEmail").value = $("signUpEmail").value.trim();
          selectAuthTab("signin");
          setMessage("สมัครสมาชิกสำเร็จ กรุณาเข้าสู่ระบบ");
        }
      } catch (error) {
        setMessage(`สร้างบัญชีไม่สำเร็จ: ${error.message}`, "error");
      } finally {
        setBusy(form, false);
      }
    });

    $("resetPasswordForm")?.addEventListener("submit", async event => {
      event.preventDefault();
      const form = event.currentTarget;
      setBusy(form, true, "กำลังส่งอีเมล…");
      setMessage("");
      try {
        const { error } = await client.auth.resetPasswordForEmail(
          $("resetEmail").value.trim(),
          { redirectTo: `${location.origin}${location.pathname}` }
        );
        if (error) throw error;
        setMessage("ส่งลิงก์รีเซ็ตรหัสผ่านแล้ว กรุณาตรวจสอบอีเมล");
      } catch (error) {
        setMessage(`ส่งลิงก์ไม่สำเร็จ: ${error.message}`, "error");
      } finally {
        setBusy(form, false);
      }
    });

    $("updatePasswordForm")?.addEventListener("submit", async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const password = $("newPassword").value;
      const confirmation = $("confirmNewPassword").value;

      if (password !== confirmation) {
        setMessage("รหัสผ่านทั้งสองช่องไม่ตรงกัน", "error");
        return;
      }

      setBusy(form, true, "กำลังบันทึก…");
      try {
        const { error } = await client.auth.updateUser({ password });
        if (error) throw error;
        recoveryMode = false;
        setMessage("เปลี่ยนรหัสผ่านแล้ว");
        render();
      } catch (error) {
        setMessage(`เปลี่ยนรหัสผ่านไม่สำเร็จ: ${error.message}`, "error");
      } finally {
        setBusy(form, false);
      }
    });

    $("signOutButton")?.addEventListener("click", async () => {
      if (!client) return;
      const { error } = await client.auth.signOut();
      if (error) {
        setMessage(`ออกจากระบบไม่สำเร็จ: ${error.message}`, "error");
        return;
      }

      window.DriveCostScopedStorage?.activateGuest();
    });

    $("syncNowButton")?.addEventListener("click", () => syncNow("manual"));
    $("uploadLocalButton")?.addEventListener("click", forceUploadLocal);
    $("downloadCloudButton")?.addEventListener("click", () => forceDownloadCloud());

    $("useCloudDataButton")?.addEventListener("click", async () => {
      if (!currentUser) return;
      if (!confirm("ใช้ข้อมูล Cloud ของบัญชีนี้และเลิกผูกข้อมูลเดิมในเครื่องหรือไม่?")) return;
      safeStorageSet(OWNER_KEY, currentUser.id);
      ownershipBlocked = false;
      await forceDownloadCloud({ skipConfirm: true });
    });

    $("mergeLocalDataButton")?.addEventListener("click", async () => {
      if (!currentUser) return;
      if (!confirm("รวมข้อมูลในเครื่องเข้ากับบัญชีนี้หรือไม่? ควรทำเมื่อคุณเป็นเจ้าของข้อมูลเดิมเท่านั้น")) return;
      safeStorageSet(OWNER_KEY, currentUser.id);
      ownershipBlocked = false;
      render();
      await syncNow("ownership-confirmed");
    });

    $("saveProfileButton")?.addEventListener("click", async () => {
      if (!client || !currentUser) return;
      const displayName = $("profileDisplayName").value.trim().slice(0, 80);
      if (!displayName) {
        setMessage("กรอกชื่อที่แสดงก่อนบันทึก", "warning");
        return;
      }

      const { data, error } = await client
        .from("profiles")
        .upsert({
          id: currentUser.id,
          display_name: displayName
        }, { onConflict: "id" })
        .select("display_name, avatar_url")
        .single();

      if (error) {
        setMessage(`บันทึกชื่อไม่สำเร็จ: ${error.message}`, "error");
        return;
      }

      profile = data;
      renderIdentity();
      setMessage("บันทึกชื่อที่แสดงแล้ว");
    });

    $("clearLocalAccountDataButton")?.addEventListener("click", clearLocalSyncedData);

    $("editSupabaseConfigButton")?.addEventListener("click", () => {
      if (currentUser && !confirm("การเปลี่ยน Supabase Project จะออกจากระบบปัจจุบันเมื่อโหลดหน้าใหม่ ดำเนินการต่อหรือไม่?")) return;
      showOnlyState("accountSetupState");
      const config = loadConfig();
      if ($("supabaseProjectUrl")) $("supabaseProjectUrl").value = config?.url || "";
      if ($("supabasePublishableKey")) $("supabasePublishableKey").value = config?.publishableKey || "";
      setMessage("แก้ไข Project URL หรือ Publishable key แล้วกดบันทึก");
    });
  }

  async function initializeAuth() {
    await createSupabaseClient();

    if (!client) {
      render();
      if (loadConfig() && !window.supabase?.createClient) {
        setMessage("โหลด Supabase JavaScript client ไม่สำเร็จ ตรวจการเชื่อมต่ออินเทอร์เน็ตหรือ CDN", "error");
      }
      return;
    }

    client.auth.onAuthStateChange((event, nextSession) => {
      if (event === "PASSWORD_RECOVERY") recoveryMode = true;
      setTimeout(() => handleSession(nextSession, event), 0);
    });

    const { data, error } = await client.auth.getSession();
    if (error) {
      setMessage(`อ่าน session ไม่สำเร็จ: ${error.message}`, "error");
      render();
      return;
    }

    await handleSession(data.session, "INITIAL_SESSION");
  }

  async function init() {
    if (initialized) return;
    initialized = true;
    bindEvents();
    getDeviceId();
    await retireLegacyQueue();
    await updatePendingCount();
    await initializeAuth();
    render();
  }

  window.DriveCostAccount = {
    render,
    syncNow,
    get client() { return client; },
    get user() { return currentUser; },
    get state() {
      return {
        sync: currentSyncState,
        message: currentSyncMessage,
        signedIn: Boolean(currentUser),
        blocked: ownershipBlocked,
        namespace: window.DriveCostScopedStorage?.namespace || "guest"
      };
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
