// public/admin.js
document.addEventListener("DOMContentLoaded", () => {
  const apiLib = window.DONE_API;
  if (!apiLib) {
    console.error("DONE_API no cargado. ¿/api.js falla o no se está sirviendo?");
    return;
  }

  const { api, me, clearToken } = apiLib;

  // ---------------------------
  // Helpers UI
  // ---------------------------
  const $ = (id) => document.getElementById(id);

  const toastEl = $("toast");
  function toast(msg, ms = 2400) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(window.__toastT);
    window.__toastT = setTimeout(() => toastEl.classList.remove("show"), ms);
  }

  function fmtDate(d) {
    try {
      if (!d) return "-";
      return new Date(d).toLocaleString();
    } catch (_) {
      return "-";
    }
  }

  function safe(s) {
    return String(s ?? "");
  }

  function badgeRole(role) {
    const r = role === "admin" ? "admin" : "user";
    const dot = `<span class="dot"></span>`;
    return `<span class="badge ${r}">${dot}<span>${r}</span></span>`;
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copiado ✅");
    } catch {
      // fallback
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      toast("Copiado ✅");
    }
  }

  // ---------------------------
  // Auth guard
  // ---------------------------
  async function ensureAdmin() {
    const meRes = await me();
    const u = meRes.user || meRes;

    if (!u || u.role !== "admin") {
      location.replace("/app");
      return null;
    }

    $("who").textContent = `${u.name} · ${u.email}`;
    return u;
  }

  // ---------------------------
  // Tabs
  // ---------------------------
  const tabBtns = Array.from(document.querySelectorAll(".tabbtn"));
  const tabPages = {
    overview: $("tab-overview"),
    users: $("tab-users"),
    billing: $("tab-billing"),
    invoices: $("tab-invoices"),
    logs: $("tab-logs"),
  };

  function showTab(key) {
    tabBtns.forEach((b) => b.classList.toggle("active", b.dataset.tab === key));
    Object.entries(tabPages).forEach(([k, el]) => {
      if (!el) return;
      el.style.display = k === key ? "" : "none";
    });

    // carga lazy por tab
    if (key === "overview") loadStats().catch(() => {});
    if (key === "users") loadUsers().catch(() => {});
  }

  tabBtns.forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));

  // ---------------------------
  // Modal
  // ---------------------------
  const modalBackdrop = $("modalBackdrop");
  const modalBody = $("modalBody");
  const modalTitle = $("modalTitle");
  const modalClose = $("modalClose");

  function openModal(title, html) {
    modalTitle.textContent = title || "Detalle";
    modalBody.innerHTML = html || "";
    modalBackdrop.style.display = "flex";
    modalBackdrop.setAttribute("aria-hidden", "false");
  }

  function closeModal() {
    modalBackdrop.style.display = "none";
    modalBackdrop.setAttribute("aria-hidden", "true");
  }

  modalClose?.addEventListener("click", closeModal);
  modalBackdrop?.addEventListener("click", (e) => {
    if (e.target === modalBackdrop) closeModal();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });

  // ---------------------------
  // Logout + Top buttons
  // ---------------------------
  $("logout")?.addEventListener("click", () => {
    clearToken();
    location.replace("/login");
  });

  $("refreshAll")?.addEventListener("click", async () => {
    toast("Refrescando…");
    await loadStats().catch(() => {});
    await loadUsers().catch(() => {});
    toast("Listo ✅");
  });

  $("goUsers")?.addEventListener("click", () => showTab("users"));
  $("copyAdminUrl")?.addEventListener("click", () => copyToClipboard(location.href));

  // ---------------------------
  // State
  // ---------------------------
  let lastUsers = [];
  let lastStats = null;

  // ---------------------------
  // Load Stats (GET /admin/stats)
  // ---------------------------
  async function loadStats() {
    // badge API ok
    const apiBadge = $("apiBadge");
    if (apiBadge) {
      apiBadge.classList.remove("admin");
      apiBadge.querySelector("span:last-child").textContent = "API";
    }

    const stats = await api("/admin/stats");
    lastStats = stats;

    // Pintar métricas bonitas (cuando el endpoint devuelve: users, chats, messages, tasks)
if (typeof stats.users === "number") $("statUsers").textContent = String(stats.users);
if (typeof stats.chats === "number") $("statChats").textContent = String(stats.chats);
if (typeof stats.messages === "number") $("statMessages").textContent = String(stats.messages);
if (typeof stats.tasks === "number") $("statTasks").textContent = String(stats.tasks);

// Mantener el JSON pero oculto (debug)
$("stats").textContent = JSON.stringify(stats, null, 2);

    // heurística para KPIs (porque no sabemos el shape exacto)
    const totalUsers =
      stats.totalUsers ??
      stats.usersTotal ??
      stats.users?.total ??
      stats.total?.users ??
      null;

    const totalAdmins =
      stats.totalAdmins ??
      stats.adminsTotal ??
      stats.admins ??
      stats.roles?.admin ??
      null;

    // set KPIs (si no vienen, los calculamos con lastUsers cuando esté)
    if (totalUsers != null) $("kpiUsers").textContent = String(totalUsers);
    if (totalAdmins != null) $("kpiAdmins").textContent = String(totalAdmins);

    // placeholders pagos/facturas
    $("kpiPayments").textContent = "0";
    $("kpiInvoices").textContent = "0";

    // ENV badge (solo visual)
    const envBadge = $("envBadge");
    if (envBadge) {
      const isLocal = location.hostname === "localhost" || location.hostname.startsWith("192.") || location.hostname.startsWith("10.");
      envBadge.classList.toggle("admin", isLocal);
      envBadge.querySelector("span:last-child").textContent = isLocal ? "LOCAL" : "PROD";
    }

    // api ok
    if (apiBadge) {
      apiBadge.classList.add("admin");
      apiBadge.querySelector("span:last-child").textContent = "OK";
    }

    return stats;
  }

  // ---------------------------
  // Users (GET /admin/users?q=)
  // ---------------------------
  function applyUserView() {
    const role = $("roleFilter")?.value || "all";
    const sortBy = $("sortBy")?.value || "new";
    const q = ($("q")?.value || "").trim().toLowerCase();

    let list = [...lastUsers];

    // filtro por search (aunque backend ya filtra con q, esto refina)
    if (q) {
      list = list.filter((u) => {
        const name = safe(u.name).toLowerCase();
        const email = safe(u.email).toLowerCase();
        return name.includes(q) || email.includes(q);
      });
    }

    // filtro por rol
    if (role !== "all") list = list.filter((u) => (u.role || "user") === role);

    // sort
    if (sortBy === "new") {
      list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    } else if (sortBy === "old") {
      list.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    } else if (sortBy === "name") {
      list.sort((a, b) => safe(a.name).localeCompare(safe(b.name)));
    } else if (sortBy === "email") {
      list.sort((a, b) => safe(a.email).localeCompare(safe(b.email)));
    }

    renderUsers(list);

    // contador
    const total = list.length;
    $("countText").textContent = `${total} usuario${total === 1 ? "" : "s"} (vista)`;

    // si stats no trae KPIs, lo calculamos aquí
    const admins = list.filter((u) => u.role === "admin").length;
    // total real del sistema no lo sabemos si backend filtra por q,
    // así que solo seteo si no hay totalUsers del stats
    if (!lastStats || (lastStats.totalUsers == null && lastStats.usersTotal == null)) {
      $("kpiUsers").textContent = String(lastUsers.length);
      $("kpiUsersSub").textContent = "Calculado desde /admin/users";
    }
    $("kpiAdmins").textContent = String(
      (lastUsers || []).filter((u) => u.role === "admin").length
    );

    return list;
  }

  function renderUsers(list) {
    const tbody = $("rows");
    tbody.innerHTML = "";

    for (const u of list) {
      const tr = document.createElement("tr");

      const name = safe(u.name) || "—";
      const email = safe(u.email) || "—";
      const status = safe(u.status) || "—";
      const role = u.role || "user";
      const created = fmtDate(u.createdAt);

      tr.innerHTML = `
        <td>
          <div style="display:flex; gap:10px; align-items:center;">
            <div style="
              width:34px; height:34px; border-radius:12px;
              background:#f1f5f9; border:1px solid #e5e7eb;
              display:flex; align-items:center; justify-content:center;
              overflow:hidden; font-weight:900;">
              ${
                u.photoUrl
                  ? `<img src="${u.photoUrl}" alt="" style="width:100%; height:100%; object-fit:cover;">`
                  : `${(name[0] || "U").toUpperCase()}`
              }
            </div>
            <div>
              <div style="font-weight:900;">${name}</div>
              <div class="muted mono" style="font-size:12px;">${safe(u._id)}</div>
            </div>
          </div>
        </td>
        <td>
          <div class="rowx" style="justify-content:space-between;">
            <span class="mono">${email}</span>
          </div>
        </td>
        <td>${badgeRole(role)}</td>
        <td class="muted">${status}</td>
        <td class="muted">${created}</td>
        <td>
          <div class="rowx">
            <button class="btnx" data-action="view" data-id="${u._id}">Ver</button>
            <button class="btnx" data-action="copyEmail" data-email="${email}">Copiar email</button>
            <button class="btnx" data-action="toggleRole" data-id="${u._id}" data-role="${role}">
              ${role === "admin" ? "Hacer user" : "Hacer admin"}
            </button>
          </div>
        </td>
      `;

      tbody.appendChild(tr);
    }

    // listeners
    tbody.querySelectorAll("button[data-action]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const action = btn.getAttribute("data-action");

        if (action === "copyEmail") {
          const email = btn.getAttribute("data-email") || "";
          return copyToClipboard(email);
        }

        if (action === "view") {
          const id = btn.getAttribute("data-id");
          const user = lastUsers.find((x) => x._id === id);
          if (!user) return toast("Usuario no encontrado");

          const html = `
            <div class="rowx" style="justify-content:space-between;">
              <div class="rowx">
                <div style="
                  width:54px; height:54px; border-radius:16px;
                  background:#f1f5f9; border:1px solid #e5e7eb;
                  display:flex; align-items:center; justify-content:center;
                  overflow:hidden; font-weight:900; font-size:18px;">
                  ${
                    user.photoUrl
                      ? `<img src="${user.photoUrl}" alt="" style="width:100%; height:100%; object-fit:cover;">`
                      : `${(safe(user.name)[0] || "U").toUpperCase()}`
                  }
                </div>
                <div>
                  <div style="font-size:18px;font-weight:900;">${safe(user.name) || "—"}</div>
                  <div class="muted mono">${safe(user.email)}</div>
                </div>
              </div>
              <div class="rowx">
                ${badgeRole(user.role || "user")}
              </div>
            </div>

            <div class="hr"></div>

            <div class="rowx" style="gap:12px;">
              <button class="btnx" id="mCopyId">📋 Copiar ID</button>
              <button class="btnx" id="mMail">✉️ Abrir email</button>
              <button class="btnx primary" id="mToggleRole">
                ${user.role === "admin" ? "Hacer user" : "Hacer admin"}
              </button>
            </div>

            <div class="hr"></div>

            <div class="muted" style="margin-bottom:6px;">Perfil</div>
            <div class="pre">
              <div><b>id:</b> <span class="mono">${safe(user._id)}</span></div>
              <div><b>email:</b> <span class="mono">${safe(user.email)}</span></div>
              <div><b>name:</b> ${safe(user.name)}</div>
              <div><b>status:</b> ${safe(user.status) || "-"}</div>
              <div><b>photoUrl:</b> ${safe(user.photoUrl) || "-"}</div>
              <div><b>role:</b> ${safe(user.role) || "user"}</div>
              <div><b>createdAt:</b> ${fmtDate(user.createdAt)}</div>
              <div><b>updatedAt:</b> ${fmtDate(user.updatedAt)}</div>
            </div>
          `;

          openModal("Usuario", html);

          $("mCopyId")?.addEventListener("click", () => copyToClipboard(user._id));
          $("mMail")?.addEventListener("click", () => {
            location.href = `mailto:${encodeURIComponent(user.email || "")}`;
          });

          $("mToggleRole")?.addEventListener("click", async () => {
            await toggleRole(user._id, user.role || "user");
            closeModal();
          });

          return;
        }

        if (action === "toggleRole") {
          const id = btn.getAttribute("data-id");
          const current = btn.getAttribute("data-role");
          await toggleRole(id, current);
          return;
        }
      });
    });
  }

  async function toggleRole(id, currentRole) {
    const next = currentRole === "admin" ? "user" : "admin";
    if (!confirm(`¿Cambiar role a "${next}"?`)) return;

    try {
      toast("Actualizando role…");
      await api(`/admin/users/${id}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role: next }),
      });
      toast("Role actualizado ✅");
      await loadUsers(true);
    } catch (e) {
      toast("Error actualizando role");
      console.error(e);
    }
  }

  async function loadUsers(silent = false) {
    if (!silent) $("msg").textContent = "Cargando…";

    const q = ($("q")?.value || "").trim();
    const url = "/admin/users" + (q ? `?q=${encodeURIComponent(q)}` : "");
    const users = await api(url);

    lastUsers = Array.isArray(users) ? users : [];
    applyUserView();

    if (!silent) $("msg").textContent = `OK · ${lastUsers.length} cargados`;

    return lastUsers;
  }

  // ---------------------------
  // Events (filters / search)
  // ---------------------------
  const qInput = $("q");
  qInput?.addEventListener("input", () => {
    clearTimeout(window.__t);
    window.__t = setTimeout(() => {
      // volvemos a pedir al backend con q para que sea rápido en DB
      loadUsers(true).catch(() => {});
    }, 250);
  });

  $("roleFilter")?.addEventListener("change", applyUserView);
  $("sortBy")?.addEventListener("change", applyUserView);
  $("reloadUsers")?.addEventListener("click", () => loadUsers().catch(() => {}));

  $("exportCsv")?.addEventListener("click", () => {
    const view = applyUserView();
    const rows = [
      ["_id", "email", "name", "status", "photoUrl", "role", "createdAt", "updatedAt"],
      ...view.map((u) => [
        safe(u._id),
        safe(u.email),
        safe(u.name),
        safe(u.status),
        safe(u.photoUrl),
        safe(u.role),
        safe(u.createdAt),
        safe(u.updatedAt),
      ]),
    ];

    const csv = rows
      .map((r) =>
        r
          .map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`)
          .join(",")
      )
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `done_users_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  // ---------------------------
  // Boot
  // ---------------------------
  (async () => {
    try {
      await ensureAdmin();

      $("toggleRaw")?.addEventListener("click", () => {
  const box = $("rawBox");
  if (!box) return;
  const isOpen = box.style.display !== "none";
  box.style.display = isOpen ? "none" : "";
  $("toggleRaw").textContent = isOpen ? "Ver detalle (debug)" : "Ocultar detalle";
});

      // carga overview first
      await loadStats().catch(() => {});
      // pre-carga users para KPIs si hace falta
      await loadUsers(true).catch(() => {});

      // subtext KPI
      $("kpiUsersSub").textContent = "Total en el sistema";

      // arranca en overview
      showTab("overview");
      toast("Admin listo ✅");
    } catch (e) {
      console.error(e);
      location.replace("/login");
    }
  })();
});
