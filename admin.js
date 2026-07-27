(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const runtime = window.DRIVECOST_RUNTIME_CONFIG || {};
  const supabaseConfig = runtime.supabase || {};

  let client = null;
  let session = null;
  let currentAdmin = null;
  let refreshTimer = null;

  function setText(id, value) {
    const element = $(id);
    if (element) element.textContent = value ?? "—";
  }

  function number(value) {
    return Number(value || 0).toLocaleString("th-TH");
  }

  function bytes(value) {
    const amount = Number(value || 0);
    if (!Number.isFinite(amount) || amount <= 0) return "0 B";
    if (amount < 1024) return `${amount.toLocaleString("th-TH")} B`;
    if (amount < 1024 ** 2) return `${(amount / 1024).toLocaleString("th-TH", { maximumFractionDigits: 1 })} KB`;
    return `${(amount / 1024 ** 2).toLocaleString("th-TH", { maximumFractionDigits: 2 })} MB`;
  }

  function date(value) {
    if (!value) return "—";
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) return "—";
    return parsed.toLocaleString("th-TH", {
      dateStyle: "medium",
      timeStyle: "short"
    });
  }

  function setMessage(message, tone = "") {
    const element = $("dashboardMessage");
    if (!element) return;
    element.textContent = message || "";
    element.dataset.tone = tone;
  }

  function setLoginMessage(message, tone = "") {
    const element = $("adminLoginMessage");
    if (!element) return;
    element.textContent = message || "";
    element.dataset.tone = tone;
  }

  function setBusy(button, busy, busyText) {
    if (!button) return;
    if (busy) {
      button.dataset.originalText = button.textContent;
      button.textContent = busyText || "กำลังดำเนินการ…";
      button.disabled = true;
    } else {
      button.disabled = false;
      if (button.dataset.originalText) {
        button.textContent = button.dataset.originalText;
        delete button.dataset.originalText;
      }
    }
  }

  async function accessToken() {
    if (!client) return "";
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    session = data.session || null;
    return session?.access_token || "";
  }

  async function api(path, options = {}) {
    const token = await accessToken();
    if (!token) {
      const error = new Error("กรุณาเข้าสู่ระบบผู้ดูแล");
      error.status = 401;
      throw error;
    }

    const response = await fetch(path, {
      method: options.method || "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: "no-store"
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      const error = new Error(body.message || body.error || `HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }

    return body;
  }

  function showLogin(message = "") {
    $("adminLoginPanel").hidden = false;
    $("adminDashboard").hidden = true;
    $("adminSignOutButton").hidden = true;
    currentAdmin = null;
    clearTimeout(refreshTimer);
    if (message) setLoginMessage(message, "warning");
  }

  function showDashboard() {
    $("adminLoginPanel").hidden = true;
    $("adminDashboard").hidden = false;
    $("adminSignOutButton").hidden = false;
    setLoginMessage("");
  }

  function definitionList(rootId, rows) {
    const root = $(rootId);
    if (!root) return;
    root.textContent = "";

    rows.forEach(([term, description]) => {
      const row = document.createElement("div");
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = term;
      dd.textContent = description ?? "—";
      row.append(dt, dd);
      root.append(row);
    });
  }

  function renderChecks(checks) {
    const root = $("integrityChecks");
    root.textContent = "";

    (checks || []).forEach(check => {
      const row = document.createElement("article");
      row.className = `check-item ${check.ok ? "healthy" : check.level || "warning"}`;

      const mark = document.createElement("span");
      mark.className = "check-mark";
      mark.textContent = check.ok ? "✓" : "!";

      const copy = document.createElement("div");
      const title = document.createElement("strong");
      const detail = document.createElement("span");
      title.textContent = check.label || check.id;
      detail.textContent = check.detail || "—";
      copy.append(title, detail);
      row.append(mark, copy);
      root.append(row);
    });

    setText("checkCount", `${number(checks?.length || 0)} รายการ`);
  }

  function renderOverview(data) {
    const statusMap = {
      healthy: ["ระบบพร้อมใช้งาน", "ไม่พบข้อผิดพลาดสำคัญ"],
      warning: ["พร้อมใช้งานโดยมีข้อควรตรวจ", `คำเตือน ${number(data.warnings)} รายการ`],
      critical: ["ต้องแก้ไขก่อนให้บริการ", `ข้อผิดพลาดสำคัญ ${number(data.criticalFailures)} รายการ`]
    };

    const [statusText, detailText] = statusMap[data.status] || statusMap.warning;
    setText("overallStatus", statusText);
    setText("overallDetail", detailText);
    setText("overviewGeneratedAt", date(data.generatedAt));

    const orb = $("overallOrb");
    orb.className = `status-orb ${data.status || "warning"}`;
    const card = $("overallCard");
    card.dataset.status = data.status || "warning";

    const auth = data.auth || {};
    const database = data.database || {};
    const fuel = data.fuel || {};

    setText("metricUsers", number(auth.total));
    setText(
      "metricUsersDetail",
      `ยืนยันแล้ว ${number(auth.confirmed)} • ยังไม่ยืนยัน ${number(auth.unconfirmed)}`
    );

    setText("metricProfiles", number(database.profiles_count));
    setText(
      "metricProfilesDetail",
      `ไม่มีข้อมูลซิงก์ ${number(database.profiles_without_sync)}`
    );

    setText("metricSync", number(database.sync_count));
    setText(
      "metricSyncDetail",
      `เก่าเกิน 30 วัน ${number(database.stale_sync_30d)}`
    );

    setText("metricFuel", fuel.cached ? "พร้อม" : "ยังไม่มีแคช");
    setText(
      "metricFuelDetail",
      fuel.cachedAt ? `แคชเมื่อ ${date(fuel.cachedAt)}` : "รอตรวจราคาครั้งแรก"
    );

    renderChecks(data.checks || []);

    const deployment = data.deployment || {};
    definitionList("deploymentDetails", [
      ["เวอร์ชัน", deployment.version],
      ["Environment", deployment.environment],
      ["Node.js", deployment.node],
      ["Uptime", `${number(deployment.uptimeSeconds)} วินาที`],
      ["Render service", deployment.serviceName || "—"],
      ["Branch", deployment.branch || "—"],
      ["Commit", deployment.commit ? deployment.commit.slice(0, 12) : "—"],
      ["Instance", deployment.instanceId || "—"],
      ["URL", deployment.externalUrl || "—"]
    ]);

    definitionList("fuelDetails", [
      ["สถานะแคช", fuel.cached ? "มีข้อมูล" : "ยังไม่มีข้อมูล"],
      ["เวลาที่แคช", date(fuel.cachedAt)],
      ["อายุแคช", fuel.ageMs == null ? "—" : `${number(Math.floor(fuel.ageMs / 1000))} วินาที`],
      ["ข้อมูลเก่า", fuel.stale == null ? "—" : fuel.stale ? "ใช่" : "ไม่"],
      ["กำลังดึงข้อมูล", fuel.inFlight ? "ใช่" : "ไม่"],
      ["ต้นทาง", fuel.upstream || "—"],
      ["payload สูงสุด", bytes(database.max_payload_bytes)],
      ["payload เฉลี่ย", bytes(database.avg_payload_bytes)]
    ]);

    setText(
      "environmentPill",
      `${deployment.environment || "unknown"} • v${deployment.version || "—"}`
    );
  }

  function renderUsers(data) {
    const root = $("usersTableBody");
    root.textContent = "";

    if (!data.users?.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 4;
      cell.className = "empty-cell";
      cell.textContent = "ไม่พบผู้ใช้";
      row.append(cell);
      root.append(row);
      return;
    }

    data.users.forEach(user => {
      const row = document.createElement("tr");
      const values = [
        user.displayName
          ? `${user.displayName} • ${user.emailMasked}`
          : user.emailMasked,
        user.confirmed ? "ยืนยันแล้ว" : "ยังไม่ยืนยัน",
        date(user.createdAt),
        date(user.lastSignInAt)
      ];

      values.forEach(value => {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.append(cell);
      });

      root.append(row);
    });
  }

  function renderAudit(data) {
    const root = $("auditList");
    root.textContent = "";

    if (!data.entries?.length) {
      const empty = document.createElement("div");
      empty.className = "empty-cell";
      empty.textContent = "ยังไม่มีกิจกรรมผู้ดูแล";
      root.append(empty);
      return;
    }

    data.entries.forEach(entry => {
      const row = document.createElement("article");
      row.className = "audit-item";

      const actor = document.createElement("div");
      const actorName = document.createElement("strong");
      const actorMeta = document.createElement("span");
      actorName.textContent = entry.admin_email_masked || "ผู้ดูแล";
      actorMeta.textContent = entry.ip_hash ? `IP hash ${entry.ip_hash}` : "ไม่เก็บ IP ดิบ";
      actor.append(actorName, actorMeta);

      const action = document.createElement("div");
      const actionName = document.createElement("strong");
      const actionMeta = document.createElement("span");
      actionName.textContent = entry.action || "unknown";
      actionMeta.textContent = `${entry.target_type || "system"}${entry.target_id ? ` • ${entry.target_id}` : ""}`;
      action.append(actionName, actionMeta);

      const timestamp = document.createElement("time");
      timestamp.textContent = date(entry.created_at);

      row.append(actor, action, timestamp);
      root.append(row);
    });
  }

  async function loadOverview({ fresh = false } = {}) {
    const data = await api(`/api/admin/overview${fresh ? "?fresh=1" : ""}`);
    renderOverview(data);
    return data;
  }

  async function loadUsers() {
    const data = await api("/api/admin/users?page=1&perPage=25");
    renderUsers(data);
  }

  async function loadAudit() {
    try {
      const data = await api("/api/admin/audit?page=1&perPage=30");
      renderAudit(data);
    } catch (error) {
      renderAudit({ entries: [] });
      setMessage(`อ่านบันทึกผู้ดูแลไม่ได้: ${error.message}`, "warning");
    }
  }

  async function loadDashboard({ fresh = false } = {}) {
    setMessage("กำลังตรวจสอบระบบ…");
    try {
      await Promise.all([
        loadOverview({ fresh }),
        loadUsers(),
        loadAudit()
      ]);
      setMessage("ตรวจสอบข้อมูลล่าสุดแล้ว");
      scheduleRefresh();
    } catch (error) {
      if ([401, 403].includes(error.status)) {
        await client?.auth.signOut().catch(() => {});
        showLogin(
          error.status === 403
            ? "บัญชีนี้ไม่ได้รับสิทธิ์ผู้ดูแล"
            : "Session หมดอายุ กรุณาเข้าสู่ระบบใหม่"
        );
        return;
      }
      setMessage(`ตรวจสอบระบบไม่สำเร็จ: ${error.message}`, "error");
    }
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      if (!document.hidden && currentAdmin) {
        loadOverview().catch(() => {});
      }
      scheduleRefresh();
    }, 60_000);
  }

  async function authorizeCurrentSession() {
    try {
      const me = await api("/api/admin/me");
      currentAdmin = me;
      setText(
        "adminIdentity",
        `${me.user.displayName || me.user.email} • สิทธิ์ ${me.role}`
      );
      showDashboard();
      await loadDashboard({ fresh: true });
    } catch (error) {
      if (error.status === 403) {
        await client?.auth.signOut().catch(() => {});
        showLogin("บัญชีนี้ไม่ได้รับสิทธิ์ผู้ดูแล");
        return;
      }
      if (error.status === 401) {
        showLogin();
        return;
      }
      showLogin(`ตรวจสอบสิทธิ์ไม่สำเร็จ: ${error.message}`);
    }
  }

  async function initialize() {
    setText(
      "environmentPill",
      `${runtime.environment || "unknown"} • v${runtime.version || "—"}`
    );

    if (!runtime.admin?.enabled) {
      showLogin("ระบบแอดมินถูกปิดจากการตั้งค่าเซิร์ฟเวอร์");
      $("adminLoginForm").querySelectorAll("input,button").forEach(element => {
        element.disabled = true;
      });
      return;
    }

    if (
      !window.supabase?.createClient ||
      !supabaseConfig.url ||
      !supabaseConfig.publishableKey
    ) {
      showLogin("ยังไม่ได้ตั้งค่า Supabase สำหรับ Production");
      return;
    }

    client = window.supabase.createClient(
      supabaseConfig.url,
      supabaseConfig.publishableKey,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storageKey: "drivecost-admin-auth-v1"
        }
      }
    );

    client.auth.onAuthStateChange((_event, nextSession) => {
      session = nextSession || null;
    });

    const { data } = await client.auth.getSession();
    session = data.session || null;

    if (session) {
      await authorizeCurrentSession();
    } else {
      showLogin();
    }
  }

  $("adminLoginForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    setBusy(button, true, "กำลังเข้าสู่ระบบ…");
    setLoginMessage("");

    try {
      const { data, error } = await client.auth.signInWithPassword({
        email: $("adminEmail").value.trim(),
        password: $("adminPassword").value
      });

      if (error) throw error;
      session = data.session || null;
      await authorizeCurrentSession();
    } catch (error) {
      setLoginMessage(`เข้าสู่ระบบไม่สำเร็จ: ${error.message}`, "error");
    } finally {
      setBusy(button, false);
    }
  });

  $("adminSignOutButton")?.addEventListener("click", async () => {
    await client?.auth.signOut().catch(() => {});
    session = null;
    showLogin("ออกจากระบบผู้ดูแลแล้ว");
  });

  $("refreshDashboardButton")?.addEventListener("click", async event => {
    setBusy(event.currentTarget, true, "กำลังรีเฟรช…");
    await loadDashboard({ fresh: false });
    setBusy(event.currentTarget, false);
  });

  $("runIntegrityButton")?.addEventListener("click", async event => {
    const button = event.currentTarget;
    setBusy(button, true, "กำลังตรวจทุกส่วน…");
    setMessage("กำลังตรวจ Auth, ตาราง, payload และการตั้งค่า…");

    try {
      const overview = await api("/api/admin/run-check", {
        method: "POST",
        body: {}
      });
      renderOverview(overview);
      await loadAudit();
      setMessage("ตรวจสอบทั้งระบบเสร็จแล้ว");
    } catch (error) {
      setMessage(`ตรวจสอบไม่สำเร็จ: ${error.message}`, "error");
    } finally {
      setBusy(button, false);
    }
  });

  $("reloadUsersButton")?.addEventListener("click", async event => {
    setBusy(event.currentTarget, true, "กำลังโหลด…");
    try {
      await loadUsers();
    } catch (error) {
      setMessage(`โหลดผู้ใช้ไม่สำเร็จ: ${error.message}`, "error");
    } finally {
      setBusy(event.currentTarget, false);
    }
  });

  $("reloadAuditButton")?.addEventListener("click", async event => {
    setBusy(event.currentTarget, true, "กำลังโหลด…");
    await loadAudit();
    setBusy(event.currentTarget, false);
  });

  $("refreshFuelButton")?.addEventListener("click", async event => {
    const button = event.currentTarget;
    setBusy(button, true, "กำลังตรวจต้นทาง…");
    setMessage("กำลังเชื่อมต่อ PTT OR…");

    try {
      await api("/api/admin/fuel/refresh", {
        method: "POST",
        body: {}
      });
      await loadOverview({ fresh: true });
      await loadAudit();
      setMessage("อัปเดตราคาจากต้นทางแล้ว");
    } catch (error) {
      setMessage(`ตรวจราคาต้นทางไม่สำเร็จ: ${error.message}`, "error");
    } finally {
      setBusy(button, false);
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && currentAdmin) {
      loadOverview().catch(() => {});
    }
  });

  initialize().catch(error => {
    showLogin(`เปิดระบบผู้ดูแลไม่สำเร็จ: ${error.message}`);
  });
})();
