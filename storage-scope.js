(() => {
  "use strict";

  const APP_DATA_KEYS = [
    "drivecost-v2-scenarios",
    "drivecost-v2-history",
    "drivecost-v2-prices",
    "drivecost-v2-price-metadata",
    "drivecost-v2-price-updated",
    "drivecost-v2-settings",
    "drivecost-v2-draft",
    "drivecost-v3-actual-fill-records",
    "drivecost-v2.1-accessibility",
    "drivecost-live-price-settings-v1",
    "drivecost-live-prices-v1",
    "drivecost-sync-section-meta-v1",
    "drivecost-sync-owner-user-id-v1",
    "drivecost-sync-last-success-v1",
    "drivecost-sync-dirty-v1",
    "drivecost-sync-change-revision-v1"
  ];

  const SCOPED_KEYS = new Set(APP_DATA_KEYS);
  const ACTIVE_SCOPE_KEY = "drivecost-active-data-scope-v1";
  const NEXT_SCOPE_KEY = "drivecost-next-data-scope-v1";
  const MIGRATION_LOG_KEY = "drivecost-data-scope-migrations-v1";
  const PREFIX = "drivecost-scope-v1:";

  const nativeStorage = {
    getItem: Storage.prototype.getItem,
    setItem: Storage.prototype.setItem,
    removeItem: Storage.prototype.removeItem,
    key: Storage.prototype.key
  };

  function rawGet(key) {
    try {
      return nativeStorage.getItem.call(window.localStorage, String(key));
    } catch {
      return null;
    }
  }

  function rawSet(key, value) {
    try {
      nativeStorage.setItem.call(window.localStorage, String(key), String(value));
      return true;
    } catch {
      return false;
    }
  }

  function rawRemove(key) {
    try {
      nativeStorage.removeItem.call(window.localStorage, String(key));
      return true;
    } catch {
      return false;
    }
  }

  function rawKeys() {
    const keys = [];
    try {
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = nativeStorage.key.call(window.localStorage, index);
        if (key !== null) keys.push(key);
      }
    } catch {}
    return keys;
  }

  function parse(value, fallback = null) {
    try {
      return value ? JSON.parse(value) : fallback;
    } catch {
      return fallback;
    }
  }

  function findUserId(value, depth = 0) {
    if (!value || depth > 6) return "";

    if (typeof value === "object") {
      const directId =
        value?.user?.id ||
        value?.session?.user?.id ||
        value?.currentSession?.user?.id;

      if (typeof directId === "string" && directId.length >= 20) {
        return directId;
      }

      for (const nested of Object.values(value)) {
        const found = findUserId(nested, depth + 1);
        if (found) return found;
      }
    }

    return "";
  }

  function detectStoredSessionUserId() {
    for (const key of rawKeys()) {
      if (!key.startsWith("drivecost-auth-")) continue;
      const userId = findUserId(parse(rawGet(key), null));
      if (userId) return userId;
    }
    return "";
  }

  function normalizeScope(scope) {
    const value = String(scope || "").trim();
    if (value === "guest") return "guest";
    if (value.startsWith("user:") && value.length > 25) return value;
    return "guest";
  }

  function physicalKey(logicalKey, scope = activeScope) {
    return `${PREFIX}${encodeURIComponent(normalizeScope(scope))}:${logicalKey}`;
  }

  function migrationLog() {
    return parse(rawGet(MIGRATION_LOG_KEY), {}) || {};
  }

  function hasLegacyData() {
    return APP_DATA_KEYS.some(key => rawGet(key) !== null);
  }

  function migrateLegacyTo(scope) {
    const targetScope = normalizeScope(scope);
    const log = migrationLog();

    if (log[targetScope] === true && !hasLegacyData()) return false;

    let moved = false;
    for (const logicalKey of APP_DATA_KEYS) {
      const legacyValue = rawGet(logicalKey);
      if (legacyValue === null) continue;

      const targetKey = physicalKey(logicalKey, targetScope);
      if (rawGet(targetKey) === null) {
        rawSet(targetKey, legacyValue);
      }

      rawRemove(logicalKey);
      moved = true;
    }

    log[targetScope] = true;
    rawSet(MIGRATION_LOG_KEY, JSON.stringify(log));
    return moved;
  }

  const requestedScope = rawGet(NEXT_SCOPE_KEY);
  const detectedUserId = detectStoredSessionUserId();

  let activeScope = requestedScope
    ? normalizeScope(requestedScope)
    : detectedUserId
      ? `user:${detectedUserId}`
      : "guest";

  rawRemove(NEXT_SCOPE_KEY);
  rawSet(ACTIVE_SCOPE_KEY, activeScope);

  // When a valid account session is already available, legacy DriveCost data
  // belongs to that account and is migrated before the app reads it.
  if (activeScope.startsWith("user:")) {
    migrateLegacyTo(activeScope);
  }

  function scopedGet(logicalKey) {
    const scopedValue = rawGet(physicalKey(logicalKey));
    if (scopedValue !== null) return scopedValue;

    // Compatibility fallback until authentication has been resolved.
    return rawGet(logicalKey);
  }

  function scopedSet(logicalKey, value) {
    const result = rawSet(physicalKey(logicalKey), value);
    rawRemove(logicalKey);
    return result;
  }

  function scopedRemove(logicalKey) {
    rawRemove(physicalKey(logicalKey));
    rawRemove(logicalKey);
  }

  Storage.prototype.getItem = function driveCostScopedGetItem(key) {
    const stringKey = String(key);
    if (this === window.localStorage && SCOPED_KEYS.has(stringKey)) {
      return scopedGet(stringKey);
    }
    return nativeStorage.getItem.call(this, stringKey);
  };

  Storage.prototype.setItem = function driveCostScopedSetItem(key, value) {
    const stringKey = String(key);
    if (this === window.localStorage && SCOPED_KEYS.has(stringKey)) {
      scopedSet(stringKey, String(value));
      return;
    }
    nativeStorage.setItem.call(this, stringKey, String(value));
  };

  Storage.prototype.removeItem = function driveCostScopedRemoveItem(key) {
    const stringKey = String(key);
    if (this === window.localStorage && SCOPED_KEYS.has(stringKey)) {
      scopedRemove(stringKey);
      return;
    }
    nativeStorage.removeItem.call(this, stringKey);
  };

  function setScope(scope, reload = true) {
    const nextScope = normalizeScope(scope);

    if (nextScope.startsWith("user:")) {
      migrateLegacyTo(nextScope);
    }

    activeScope = nextScope;
    rawSet(ACTIVE_SCOPE_KEY, nextScope);
    rawSet(NEXT_SCOPE_KEY, nextScope);

    if (reload) {
      window.location.reload();
    }
  }

  function finalizeGuestMigration() {
    if (activeScope !== "guest") return false;
    return migrateLegacyTo("guest");
  }

  function scopeHasData(scope) {
    const normalized = normalizeScope(scope);
    return APP_DATA_KEYS.some(key => rawGet(physicalKey(key, normalized)) !== null);
  }

  function accountScope(userId) {
    return `user:${String(userId || "").trim()}`;
  }

  window.DriveCostScopedStorage = Object.freeze({
    get namespace() {
      return activeScope;
    },
    get kind() {
      return activeScope === "guest" ? "guest" : "user";
    },
    get userId() {
      return activeScope.startsWith("user:") ? activeScope.slice(5) : "";
    },
    logicalKeys: Object.freeze([...APP_DATA_KEYS]),
    physicalKey,
    rawGet,
    rawSet,
    rawRemove,
    hasData: scopeHasData,
    finalizeGuestMigration,
    activateGuest(reload = true) {
      setScope("guest", reload);
    },
    activateUser(userId, reload = true) {
      const id = String(userId || "").trim();
      if (!id) return;
      setScope(accountScope(id), reload);
    },
    // Used by automated regression tests and diagnostics.
    activateScope(scope, reload = true) {
      setScope(scope, reload);
    }
  });
})();
