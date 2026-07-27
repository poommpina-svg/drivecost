window.addEventListener("load", () => {
  const accountPage = document.getElementById("page-account");
  const logo = document.querySelector(".simple-account-logo svg");

  if (logo) {
    logo.style.maxWidth = "28px";
    logo.style.maxHeight = "28px";
  }

  if (!window.supabase && accountPage) {
    const message = document.getElementById("accountMessage");
    if (message) {
      message.hidden = false;
      message.className = "account-message warning";
      message.textContent =
        "โหลดระบบบัญชีไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตแล้วเปิดหน้าใหม่";
    }
  }

  setTimeout(async () => {
    const entry = document.getElementById("productionAdminEntry");
    const account = window.DriveCostAccount;
    if (!entry || !account?.client || !account?.user) return;

    try {
      const { data } = await account.client.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;

      const response = await fetch("/api/admin/me", {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json"
        },
        cache: "no-store"
      });

      entry.hidden = !response.ok;
    } catch {
      entry.hidden = true;
    }
  }, 1200);
});
