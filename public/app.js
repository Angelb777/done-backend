// public/app.js
document.addEventListener("DOMContentLoaded", async () => {
  const API = window.DONE_API;

  // ------- helpers DOM
  const $ = (id) => document.getElementById(id);

  function applyBottomNavPadding(){
  const nav = document.querySelector(".bottomnav");
  const h = nav ? nav.offsetHeight : 80;
  document.documentElement.style.setProperty("--bottomnav-h", `${h}px`);
  }
  applyBottomNavPadding();
  window.addEventListener("resize", applyBottomNavPadding);

  // ------- session
  $("logout")?.addEventListener("click", () => {
    API.clearToken();
    location.href = "/";
  });

  // ------- modal
  const modalEl = $("modal");
  const modalTitle = $("modalTitle");
  const modalBody = $("modalBody");
  $("modalClose")?.addEventListener("click", closeModal);
  modalEl?.addEventListener("click", (e) => { if(e.target === modalEl) closeModal(); });

  function openModal(title, html){
    modalTitle.textContent = title;
    modalBody.innerHTML = html;
    modalEl.classList.remove("hidden");
  }
  function closeModal(){
    modalEl.classList.add("hidden");
    modalBody.innerHTML = "";
  }
  // ------- routing views (bottom nav)
  const views = {
    chats: $("view-chats"),
    dashboard: $("view-dashboard"),
    profile: $("view-profile"),
  };

  document.querySelectorAll(".navitem").forEach(btn => {
    btn.addEventListener("click", async () => {
      const v = btn.dataset.view;
      setView(v);
      if(v === "chats") await loadChats({showSpinner:false});
      if(v === "dashboard") await loadDashboard();
      if(v === "profile") await renderProfile();
    });
  });

  function setView(name){
    Object.entries(views).forEach(([k, el]) => el.classList.toggle("hidden", k !== name));
    document.querySelectorAll(".navitem").forEach(b => b.classList.toggle("active", b.dataset.view === name));
  }

  // ------- auth + bootstrap
  let ME = null;
  try{
    const meRes = await API.me();
    ME = meRes.user || meRes;
    $("rolePill").textContent = ME.role || "user";
    if ((ME.role || "") === "admin") location.href = "/admin-panel";
  }catch(e){
    location.href = "/login";
    return;
  }

  // ------- CHATS
  let chatsPoll = null;
  let chatsFetching = false;

  $("btnSearchDm")?.addEventListener("click", () => openNewDmModal());
  $("btnNewGroup")?.addEventListener("click", () => openNewGroupModal());

  async function loadChats({showSpinner=true} = {}){
    if(chatsFetching) return;
    chatsFetching = true;

    const state = $("chatsState");
    const list = $("chatsList");

    if(showSpinner) state.textContent = "Cargando chats…";

    try{
      const raw = await API.getChats();
      const chats = Array.isArray(raw) ? raw : (raw.chats || []);
      list.innerHTML = "";

      if(!chats.length){
        state.textContent = "No tienes chats aún. Pulsa la lupa para empezar.";
        return;
      }
      state.textContent = "";

      for(const c of chats){
        list.appendChild(renderChatRow(c));
      }
    }catch(e){
      state.textContent = e.message || String(e);
    }finally{
      chatsFetching = false;
    }
  }

  function prettyStatus(raw){
    const v = String(raw || "").trim().toUpperCase();
    if(v === "OCUPADO") return "Ocupado";
    if(v === "DISPONIBLE") return "Disponible";
    if(!v) return "—";
    return raw;
  }

  function chatSubtitle(c){
    if(c.type === "DM"){
      const st = (c.peer?.status || "").trim();
      return st ? prettyStatus(st) : "Disponible";
    }
    return "Grupo";
  }

  function fullUrl(urlOrPath){
    const u = String(urlOrPath || "").trim();
    if(!u) return "";
    if(u.startsWith("http://") || u.startsWith("https://")) return u;
    return u.startsWith("/") ? u : `/${u}`;
  }

  function openChatContextMenu(c){
  const title = String(c.displayTitle ?? c.title ?? "Chat");
  const id = c.id || c._id;

  openModal("Opciones", `
    <div class="list">
      <div class="chatrow" id="ctxOpen" style="cursor:pointer;">
        <div class="chatleft">
          <div class="avatar">${(title?.[0]||"C").toUpperCase()}</div>
          <div class="chatmeta">
            <div class="title">Abrir</div>
            <div class="sub">Entrar a la conversación</div>
          </div>
        </div>
        <div class="badge">↗</div>
      </div>

      <div style="height:10px"></div>

      <div class="chatrow" id="ctxDelete" style="cursor:pointer; border:1px solid rgba(185,28,28,.25);">
        <div class="chatleft">
          <div class="avatar" style="background:rgba(185,28,28,.10); color:#b91c1c;">!</div>
          <div class="chatmeta">
            <div class="title" style="color:#b91c1c;">Eliminar chat</div>
            <div class="sub">Borra la conversación para ti</div>
          </div>
        </div>
        <div class="badge" style="background:#b91c1c;">Eliminar</div>
      </div>
    </div>
  `);

  // abrir
  document.getElementById("ctxOpen")?.addEventListener("click", () => {
    closeModal();
    const type = String(c.type || "").toUpperCase();
    location.href =
      `/chat?chatId=${encodeURIComponent(id)}` +
      `&title=${encodeURIComponent(title)}` +
      `&type=${encodeURIComponent(type)}`;
  });

  // eliminar
  document.getElementById("ctxDelete")?.addEventListener("click", async () => {
    const ok = confirm(`¿Seguro que quieres eliminar "${title}"?`);
    if(!ok) return;

    try{
      // si tu backend ya tiene DELETE /chats/:chatId
      await API.api(`/chats/${encodeURIComponent(id)}`, { method:"DELETE" });
      closeModal();
      await loadChats({showSpinner:false});
    }catch(e){
      alert(e.message || String(e));
    }
  });
  }

  function renderChatRow(c){
    const title = String(c.displayTitle ?? c.title ?? "Chat");
    const subtitle = chatSubtitle(c);
    const photo = fullUrl(c.photoUrl);
    const pending = Number(c.pendingTasksCount || 0);

    const row = document.createElement("div");
    row.className = "chatrow";
    row.addEventListener("click", () => {
    const id = c.id || c._id;
    const type = String(c.type || "").toUpperCase();
    location.href =
      `/chat?chatId=${encodeURIComponent(id)}` +
      `&title=${encodeURIComponent(title)}` +
      `&type=${encodeURIComponent(type)}`;
  });

  // ✅ CLICK DERECHO
  row.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    openChatContextMenu(c);
  });

    const left = document.createElement("div");
    left.className = "chatleft";

    const av = document.createElement("div");
    av.className = "avatar";
    if(photo){
      const img = document.createElement("img");
      img.src = photo;
      img.alt = title;
      av.appendChild(img);
    }else{
      av.textContent = title?.[0]?.toUpperCase() || "C";
    }

    const meta = document.createElement("div");
    meta.className = "chatmeta";

    const t = document.createElement("div");
    t.className = "title";
    t.textContent = title;

    const s = document.createElement("div");
    s.className = "sub";
    s.textContent = subtitle;

    meta.appendChild(t);
    meta.appendChild(s);

    left.appendChild(av);
    left.appendChild(meta);

    row.appendChild(left);

        const unread = Number(c.unreadCount || 0);

    // Right side badges (pending + unread)
    const right = document.createElement("div");
    right.style.display = "flex";
    right.style.gap = "8px";
    right.style.alignItems = "center";

    if (pending > 0) {
      const badge = document.createElement("div");
      badge.className = "badge";
      badge.textContent = `${pending} tareas`;
      right.appendChild(badge);
    }

    if (unread > 0) {
      const dot = document.createElement("div");
      dot.className = "unread"; // CSS abajo
      dot.title = `${unread} sin leer`;
      dot.textContent = unread > 99 ? "99+" : String(unread); // si quieres solo punto, borra esta línea
      right.appendChild(dot);
    }

    if (right.childNodes.length) row.appendChild(right);

    return row;
  }

  function openNewDmModal(){
    openModal("Nuevo chat", `
  <div class="field">
    <label>Busca por email o nombre…</label>
    <input class="input" id="dmQuery" placeholder="mínimo 2 letras" />
  </div>
  <div id="dmState" class="state"></div>
  <div id="dmResults" class="list"></div>
`);

    const input = document.getElementById("dmQuery");
    const state = document.getElementById("dmState");
    const resultsEl = document.getElementById("dmResults");
    let debounce = null;

    input.focus();
    input.addEventListener("input", () => {
      clearTimeout(debounce);
      debounce = setTimeout(doSearch, 250);
    });

    async function doSearch(){
      const q = input.value.trim();
      if(q.length < 2){
        state.textContent = "Escribe al menos 2 caracteres.";
        resultsEl.innerHTML = "";
        return;
      }
      state.textContent = "Buscando…";
      resultsEl.innerHTML = "";
      try{
        const raw = await API.searchUsers(q);
        const users = Array.isArray(raw) ? raw : (raw.users || []);
        state.textContent = users.length ? "" : "Sin resultados.";
        for(const u of users){
          resultsEl.appendChild(renderUserRow(u, async () => {
            try{
              await API.createDm(u.id || u._id);
              closeModal();
              await loadChats({showSpinner:false});
            }catch(e){
              state.textContent = e.message || String(e);
            }
          }));
        }
      }catch(e){
        state.textContent = e.message || String(e);
      }
    }
  }

  function openNewGroupModal(){
  openModal("Nuevo grupo", `
    <div class="field">
      <label>Nombre del grupo</label>
      <input class="input" id="groupTitle" placeholder="Ej: Equipo Obra" />
    </div>

    <div class="field">
      <label>Foto del grupo (opcional)</label>
      <div style="display:flex; gap:12px; align-items:center;">
        <div class="avatar" id="groupPhotoPreview" style="width:52px;height:52px;overflow:hidden;"></div>
        <div style="flex:1;">
          <input id="groupPhoto" type="file" accept="image/*" />
          <div class="state" style="margin-top:6px;">Puedes dejarlo vacío.</div>
        </div>
      </div>
    </div>

    <div class="field">
      <label>Añadir participantes (busca)</label>
      <input class="input" id="groupQuery" placeholder="mínimo 2 letras" />
    </div>

    <div class="state" id="groupState"></div>

    <div class="card" style="margin-bottom:10px;">
      <div style="font-weight:1000;margin-bottom:8px;">Seleccionados</div>
      <div id="groupSelected" style="display:flex;gap:8px;flex-wrap:wrap;"></div>
    </div>

    <div id="groupResults" class="list"></div>

    <div class="row right" style="margin-top:12px;">
      <button class="btn primary" id="btnCreateGroup">Crear grupo</button>
    </div>
  `);

  const titleEl = document.getElementById("groupTitle");
  const qEl = document.getElementById("groupQuery");
  const state = document.getElementById("groupState");
  const resultsEl = document.getElementById("groupResults");
  const selectedEl = document.getElementById("groupSelected");
  const createBtn = document.getElementById("btnCreateGroup");

  const photoInput = document.getElementById("groupPhoto");
  const photoPreview = document.getElementById("groupPhotoPreview");

  const selected = [];
  let debounce = null;

  // preview foto
  function paintPreview(file){
    if(!photoPreview) return;
    if(!file){
      const initial = (titleEl.value.trim()?.[0] || "G").toUpperCase();
      photoPreview.innerHTML = initial;
      return;
    }
    const url = URL.createObjectURL(file);
    photoPreview.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:cover;" />`;
    // limpiamos objectURL al cerrar modal (cuando se cierre, modalBody se borra)
    photoPreview.dataset.url = url;
  }

  // inicial
  paintPreview(null);

  titleEl.addEventListener("input", ()=>{
    if(!photoInput.files?.[0]) paintPreview(null);
  });

  photoInput.addEventListener("change", ()=>{
    // revoca anterior
    const old = photoPreview?.dataset?.url;
    if(old) { try{ URL.revokeObjectURL(old); }catch(_){} }
    paintPreview(photoInput.files?.[0] || null);
  });

  qEl.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(doSearch, 250);
  });

  createBtn.addEventListener("click", async () => {
    const title = titleEl.value.trim();
    if(!title) { state.textContent = "Pon un nombre al grupo."; return; }
    if(!selected.length) { state.textContent = "Añade al menos 1 participante."; return; }

    const photoFile = photoInput.files?.[0] || null;

    try{
      createBtn.disabled = true;
      state.textContent = "Creando…";

      // ✅ NUEVO: crea grupo + foto (si hay)
      await API.createGroupWithPhoto(
      title,
      selected.map(u => u.id || u._id),
      photoFile
     );

      closeModal();
      await loadChats({showSpinner:false});
    }catch(e){
      state.textContent = e.message || String(e);
    }finally{
      createBtn.disabled = false;
      // limpiar objectURL preview si existe
      const old = photoPreview?.dataset?.url;
      if(old) { try{ URL.revokeObjectURL(old); }catch(_){} }
    }
  });

  function renderSelected(){
    selectedEl.innerHTML = "";
    for(const u of selected){
      const chip = document.createElement("button");
      chip.className = "btn outline";
      chip.style.padding = "8px 10px";
      chip.textContent = `✕ ${u.displayName || u.name || u.email}`;
      chip.addEventListener("click", () => {
        const id = (u.id || u._id);
        const idx = selected.findIndex(x => (x.id||x._id) === id);
        if(idx >= 0) selected.splice(idx,1);
        renderSelected();
      });
      selectedEl.appendChild(chip);
    }
    if(!selected.length){
      selectedEl.innerHTML = `<span class="state">Nadie aún.</span>`;
    }
  }
  renderSelected();

  async function doSearch(){
    const q = qEl.value.trim();
    if(q.length < 2){
      state.textContent = "Escribe al menos 2 caracteres.";
      resultsEl.innerHTML = "";
      return;
    }

    state.textContent = "Buscando…";
    resultsEl.innerHTML = "";

    try{
      const raw = await API.searchUsers(q);
      let users = Array.isArray(raw) ? raw : (raw.users || []);

      const selectedIds = new Set(selected.map(u => (u.id||u._id)));
      users = users.filter(u => !selectedIds.has(u.id||u._id));

      state.textContent = users.length ? "" : "Sin resultados.";
      for(const u of users){
        resultsEl.appendChild(renderUserRow(u, () => {
          selected.push(u);
          renderSelected();
        }, "Añadir"));
      }
    }catch(e){
      state.textContent = e.message || String(e);
    }
  }
}

  function renderUserRow(u, onTap, ctaText="Abrir DM"){
    const name = u.displayName || u.name || (u.email ? u.email.split("@")[0] : "Usuario");
    const email = u.email || "";
    const initial = (name?.[0] || "?").toUpperCase();

    const row = document.createElement("div");
    row.className = "chatrow";
    row.style.cursor = "pointer";

    const left = document.createElement("div");
    left.className = "chatleft";

    const av = document.createElement("div");
    av.className = "avatar";
    av.textContent = initial;

    const meta = document.createElement("div");
    meta.className = "chatmeta";

    const t = document.createElement("div");
    t.className = "title";
    t.textContent = name;

    const s = document.createElement("div");
    s.className = "sub";
    s.textContent = email;

    meta.appendChild(t);
    meta.appendChild(s);
    left.appendChild(av);
    left.appendChild(meta);

    const badge = document.createElement("div");
    badge.className = "badge";
    badge.textContent = ctaText;

    row.appendChild(left);
    row.appendChild(badge);

    row.addEventListener("click", onTap);
    return row;
  }

  // ------- DASHBOARD (skeleton)
  // ------- DASHBOARD (Flutter-like)
let dashTab = "TAREAS"; // "TAREAS" | "HISTORIAL"

const btnDashTasks = document.getElementById("dashTabTasks");
const btnDashHistory = document.getElementById("dashTabHistory");

btnDashTasks?.addEventListener("click", async () => {
  dashTab = "TAREAS";
  btnDashTasks.classList.add("active");
  btnDashHistory.classList.remove("active");
  await loadDashboard();
});

btnDashHistory?.addEventListener("click", async () => {
  dashTab = "HISTORIAL";
  btnDashHistory.classList.add("active");
  btnDashTasks.classList.remove("active");
  await loadDashboard();
});

function pct(done, total){
  if(!total) return 0;
  return Math.round((done/total)*100);
}

function progress(tasks){
  if(!Array.isArray(tasks) || !tasks.length) return 0;

  let done = 0;
  let total = 0;

  for(const t of tasks){
    const subs = t.subtasks || [];
    if(subs.length){
      total += subs.length;
      done += subs.filter(s => s.done).length;
    } else {
      total += 1;
      if(isDoneTask(t)) done += 1;
    }
  }
  return total ? done / total : 0;
}

const TASK_COLOR_KEYS = ["gray", "yellow", "red", "blue", "green"];

function openColorPicker(task, onPick){
  const current = String(task.color || "gray");
  const html = `
    <div style="display:flex;gap:10px;flex-wrap:wrap;">
      ${TASK_COLOR_KEYS.map(k => `
        <button class="btn outline" data-color="${k}"
          style="width:44px;height:44px;border-radius:12px; padding:0; border:2px solid ${k===current ? "rgba(0,0,0,.65)" : "rgba(0,0,0,.12)"};">
          ${k}
        </button>
      `).join("")}
    </div>
  `;
  openModal("Color de tarea", html);

  modalBody.querySelectorAll("button[data-color]").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const picked = btn.dataset.color;
      closeModal();
      onPick(picked);
    });
  });
}

function isDoneTask(t){
  return String(t.status || "").toUpperCase() === "DONE";
}
function pendingCount(tasks){
  if(!Array.isArray(tasks)) return 0;
  return tasks.filter(t => !isDoneTask(t)).length;
}
function setKpis({minePending=0, assignedPending=0, visible=true}){
  const kpis = document.getElementById("dashKpis");
  const a = document.getElementById("kpiMinePending");
  const b = document.getElementById("kpiAssignedPending");
  if(a) a.textContent = String(minePending);
  if(b) b.textContent = String(assignedPending);
  if(kpis) kpis.style.display = visible ? "" : "none";
}

// orden por dueDate (null al final), si no por createdAt
function orderTasks(list){
  list.sort((a,b)=>{
    const ad = a.dueDate ? new Date(a.dueDate) : null;
    const bd = b.dueDate ? new Date(b.dueDate) : null;
    if(!ad && !bd) return new Date(a.createdAt||0) - new Date(b.createdAt||0);
    if(!ad) return 1;
    if(!bd) return -1;
    return ad - bd;
  });
  return list;
}

function ddmmyy(dateStr){
  const d = new Date(dateStr);
  if(Number.isNaN(d.getTime())) return "";
  const dd = String(d.getDate()).padStart(2,"0");
  const mm = String(d.getMonth()+1).padStart(2,"0");
  return `${dd}/${mm}`;
}

function ddmmyyhhmm(dateStr){
  const d = new Date(dateStr);
  if(Number.isNaN(d.getTime())) return "";
  const dd = String(d.getDate()).padStart(2,"0");
  const mm = String(d.getMonth()+1).padStart(2,"0");
  const yy = String(d.getFullYear()%100).padStart(2,"0");
  const hh = String(d.getHours()).padStart(2,"0");
  const mi = String(d.getMinutes()).padStart(2,"0");
  return `${dd}/${mm}/${yy} ${hh}:${mi}`;
}

function dueText(t){
  if(!t.dueDate) return "Sin fecha";
  return `Vence ${ddmmyy(t.dueDate)}`;
}

function assigneeName(t){
  return t.assigneeName || t.assignee?.displayName || t.assignee?.name || "-";
}

// adjuntos igual que flutter: muestra 2 + "+N más"
function isImageAtt(a){
  const mime = String(a.mime||"").toLowerCase();
  const url = String(a.url||"").toLowerCase();
  const name = String(a.name||"").toLowerCase();
  return mime.startsWith("image/") || url.match(/\.(png|jpg|jpeg|webp|gif)$/) || name.match(/\.(png|jpg|jpeg|webp|gif)$/);
}

function openUrl(url){
  window.open(url, "_blank");
}

function taskAttachments(t){
  const raw = Array.isArray(t.attachments) ? t.attachments
            : Array.isArray(t.taskAttachments) ? t.taskAttachments
            : [];

  return raw
    .filter(a => a && a.url)
    .map(a => {
      const u = toLocalPath(fullUrl(a.url)); // ✅ MISMO FIX que en el tile
      return {
        url: u,
        name: a.name || "Archivo",
        mime: a.mime || "",
        size: a.size || 0,
        isImage: isImageAtt({ ...a, url: u }),
      };
    });
}

// acciones backend (ajusta si tus rutas difieren)
async function toggleTask(taskId, done){
  // Flutter ignora "done" y simplemente hace toggle
  return API.api(`/tasks/${encodeURIComponent(taskId)}/toggle`, {
    method: "PATCH",
    body: JSON.stringify({})
  });
}

async function archiveTask(taskId){
  return API.api(`/tasks/${encodeURIComponent(taskId)}/archive`, {
    method: "PATCH",
    body: JSON.stringify({})
  });
}

function absUrl(u){
  const s = String(u || "").trim();
  if (!s) return "";
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  const path = s.startsWith("/") ? s : `/${s}`;
  return `${location.origin}${path}`;
}

function isImageMime(m){
  return String(m || "").toLowerCase().startsWith("image/");
}
function guessIsImageByName(name){
  const n = String(name || "").toLowerCase();
  return n.endsWith(".png") || n.endsWith(".jpg") || n.endsWith(".jpeg") || n.endsWith(".webp") || n.endsWith(".gif");
}
function hhmm(dateStr){
  const d = new Date(dateStr || Date.now());
  const h = String(d.getHours()).padStart(2,"0");
  const m = String(d.getMinutes()).padStart(2,"0");
  return `${h}:${m}`;
}

function renderAttachmentsGallery(atts){
  const images = atts.filter(a => a.isImage);
  const files  = atts.filter(a => !a.isImage);

  const wrap = document.createElement("div");
  wrap.className = "attwrap";

  if (images.length){
    const show = images.slice(0,4);
    const extra = images.length - show.length;

    if (show.length === 1){
      const img = document.createElement("img");
      img.className = "imgone";
      img.src = absUrl(show[0].url);
      img.alt = show[0].name || "img";
      img.addEventListener("click", ()=> window.open(absUrl(show[0].url), "_blank"));
      wrap.appendChild(img);
    } else {
      const grid = document.createElement("div");
      grid.className = "imggrid";
      show.forEach((a,i)=>{
        const cell = document.createElement("div");
        cell.className = "imgcell";
        const img = document.createElement("img");
        img.src = absUrl(a.url);
        img.alt = a.name || "img";
        cell.appendChild(img);

        if(i === 3 && extra > 0){
          const over = document.createElement("div");
          over.className = "imgextra";
          over.textContent = `+${extra}`;
          cell.appendChild(over);
        }

        cell.addEventListener("click", ()=> window.open(absUrl(a.url), "_blank"));
        grid.appendChild(cell);
      });
      wrap.appendChild(grid);
    }
  }

  for (const f of files){
    const row = document.createElement("div");
    row.className = "filetile";
    const name = f.name || "Archivo";
    row.innerHTML = `
      <div class="fileicon">FILE</div>
      <div class="filemeta">
        <div class="filename">${name}</div>
      </div>
      <div class="fileopen">↗</div>
    `;
    row.addEventListener("click", ()=> window.open(absUrl(f.url), "_blank"));
    wrap.appendChild(row);
  }

  return wrap;
}

async function openTaskCommentsModal({ taskId, title, taskAttachments = [] }){
  if(!taskId) return;

  const modal = document.createElement("div");
  modal.className = "imgmodal";
  modal.innerHTML = `
  <div class="imgmodal-card">

    <!-- HEADER -->
    <div class="imgmodal-top">
      <div class="imgmodal-tabs">
        <button class="btn tiny" id="tabComments">Comentarios</button>
        <button class="btn tiny" id="tabSubtasks">Subtareas</button>
      </div>
      <button class="iconbtn" id="cClose">✕</button>
    </div>

    <!-- BODY -->
    <div class="imgmodal-body">
      <!-- 🔑 CONTENEDOR CENTRADO -->
      <div class="imgmodal-inner">

        <!-- TÍTULO -->
        <div class="imgmodal-title">${title || "Tarea"}</div>

        ${taskAttachments.length ? `
          <div class="card" style="margin-bottom:12px;">
            <div style="font-weight:900;margin-bottom:10px;">Archivos de la tarea</div>
            <div id="cTaskAtts"></div>
          </div>
        ` : ""}

        <!-- ZONA SCROLL -->
        <div class="imgmodal-scroll">
          <div id="cSubtasksPanel" class="card" style="display:none; margin-bottom:12px;">
            <div style="font-weight:900;margin-bottom:10px;">Subtareas</div>
            <div id="cSubtasksState" class="state"></div>
            <div id="cSubtasksList"></div>
          </div>

          <div id="cState" class="state" style="margin:6px 0;"></div>
          <div id="cList"></div>
          <div id="cPending" style="margin-top:10px;"></div>
        </div>

        <!-- COMPOSER -->
        <div class="imgmodal-compose">
          <button class="btn outline" id="cAttach" type="button">📎</button>
          <input
            id="cText"
            class="composer-input"
            placeholder="Escribe un comentario…"
          />
          <button class="btn outline" id="cPlus" type="button">＋</button>
          <button class="btn primary" id="cSend" type="button">Enviar</button>
        </div>

      </div>
    </div>
  </div>
`;

  document.body.appendChild(modal);

  const cClose = modal.querySelector("#cClose");
  const cState = modal.querySelector("#cState");
  const cList = modal.querySelector("#cList");
  const cText = modal.querySelector("#cText");
  const cAttach = modal.querySelector("#cAttach");
  const cSend = modal.querySelector("#cSend");
  const tabComments = modal.querySelector("#tabComments");
const tabSubtasks = modal.querySelector("#tabSubtasks");
const cSubtasksPanel = modal.querySelector("#cSubtasksPanel");
const cSubtasksState = modal.querySelector("#cSubtasksState");
const cSubtasksList = modal.querySelector("#cSubtasksList");
const cPlus = modal.querySelector("#cPlus");

let tab = "comments"; // "comments" | "subtasks"
let subtasks = [];
let subtasksLoading = false;
let sending = false;
let pending = [];
let poll = null;

function setTab(name){
  tab = name;
  const isSub = tab === "subtasks";

  if (cSubtasksPanel) cSubtasksPanel.style.display = isSub ? "" : "none";
  if (cList) cList.style.display = isSub ? "none" : "";
  if (cState) cState.style.display = isSub ? "none" : "";

  if (tabComments) tabComments.style.background = !isSub ? "#fff" : "transparent";
  if (tabSubtasks) tabSubtasks.style.background = isSub ? "#fff" : "transparent";

  if (cText) cText.placeholder = isSub ? "Nueva subtarea…" : (pending.length ? "Añade un texto (opcional)…" : "Escribe un comentario…");

  if (isSub && !subtasksLoading) loadSubtasks();
}

function renderSubtasks(){
  if (!cSubtasksList) return;
  cSubtasksList.innerHTML = "";

  if (!subtasks.length){
    cSubtasksList.innerHTML = `<div class="state">Aún no hay subtareas.</div>`;
    return;
  }

  for (const s of subtasks){
    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.gap = "10px";
    row.style.alignItems = "center";
    row.style.padding = "8px 0";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!s.done;

    const txt = document.createElement("div");
    txt.style.flex = "1";
    txt.style.fontWeight = "700";
    txt.style.textDecoration = s.done ? "line-through" : "none";
    txt.textContent = s.text || "Subtarea";

    cb.addEventListener("change", async ()=>{
      // optimistic
      const prev = s.done;
      s.done = cb.checked;
      txt.style.textDecoration = s.done ? "line-through" : "none";

      try{
        await API.toggleSubtask(taskId, s.id);
        await loadSubtasks();
      }catch(e){
        s.done = prev;
        cb.checked = prev;
        txt.style.textDecoration = prev ? "line-through" : "none";
        alert("Error en subtarea: " + (e.message || String(e)));
      }
    });

    row.appendChild(cb);
    row.appendChild(txt);
    cSubtasksList.appendChild(row);
  }
}

async function loadSubtasks(){
  if (!cSubtasksState) return;
  subtasksLoading = true;
  cSubtasksState.textContent = "Cargando subtareas…";
  try{
    const raw = await API.getSubtasks(taskId);
    subtasks = Array.isArray(raw?.subtasks) ? raw.subtasks : (Array.isArray(raw) ? raw : []);
    cSubtasksState.textContent = "";
    renderSubtasks();
  }catch(e){
    cSubtasksState.textContent = e.message || String(e);
  }finally{
    subtasksLoading = false;
  }
}
cPlus?.addEventListener("click", async ()=>{
  if (tab !== "subtasks") { setTab("subtasks"); return; }
  const text = (cText.value || "").trim();
  if (!text) return;

  try{
    cPlus.disabled = true;
    await API.createSubtask(taskId, text);
    cText.value = "";
    setTab("subtasks");
    await loadSubtasks();
  }catch(e){
    alert("Error creando subtarea: " + (e.message || String(e)));
  }finally{
    cPlus.disabled = false;
  }
});

tabComments?.addEventListener("click", ()=> setTab("comments"));
tabSubtasks?.addEventListener("click", ()=> setTab("subtasks"));
setTab("comments");
  const cPending = modal.querySelector("#cPending");
  const cTaskAtts = modal.querySelector("#cTaskAtts");

  const close = () => {
    try { clearInterval(poll); } catch(_){}
    for(const a of pending){ try{ URL.revokeObjectURL(a.url); }catch(_){} }
    modal.remove();
  };

  cClose.addEventListener("click", close);
  modal.addEventListener("click", (e)=>{ if(e.target === modal) close(); });

  if(cTaskAtts && taskAttachments.length){
    cTaskAtts.appendChild(renderAttachmentsGallery(taskAttachments));
  }

  function renderPending(){
    if(!pending.length){
      cPending.innerHTML = "";
      cText.placeholder = "Escribe un comentario…";
      return;
    }
    cText.placeholder = "Añade un texto (opcional)…";
    const show = pending.slice(0,2);

    cPending.innerHTML =
      `<div style="font-weight:900;margin-bottom:6px;">Adjuntos</div>` +
      `<div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">` +
      show.map((a,i)=>`
        <div class="attchip" style="position:relative;">
          ${a.isImage ? `<img src="${a.url}" alt="">` : `<div class="attname">${a.name}</div>`}
          <button class="attx" data-i="${i}" style="position:absolute; top:-8px; right:-8px;">✕</button>
        </div>
      `).join("") +
      (pending.length>2 ? `<div class="attmore">+${pending.length-2} más</div>` : "") +
      `</div>`;

    cPending.querySelectorAll(".attx").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const idx = Number(btn.dataset.i);
        const a = pending[idx];
        try{ URL.revokeObjectURL(a.url); }catch(_){}
        pending.splice(idx,1);
        renderPending();
      });
    });
  }

  function renderComment(c){
    const sender = c.sender || {};
    const senderName = sender.displayName || sender.name || sender.email || c.senderName || "User";
    const text = String(c.text || "");
    const createdAt = c.createdAt || c.publishedAt || c.timestamp || new Date().toISOString();

    const atts = Array.isArray(c.attachments) ? c.attachments.map(a => ({
      url: absUrl(a.url),
      name: a.name || "Archivo",
      mime: a.mime || "",
      size: a.size || 0,
      isImage: isImageMime(a.mime) || guessIsImageByName(a.name) || guessIsImageByName(a.url),
    })) : [];

    const box = document.createElement("div");
    box.style.margin = "10px 0";
    box.style.padding = "12px";
    box.style.borderRadius = "14px";
    box.style.background = "rgba(0,0,0,.06)";

    box.innerHTML = `
      <div style="font-weight:900;font-size:12px;">${senderName}</div>
      ${atts.length ? `<div class="attwrap" style="margin-top:8px;"></div>` : ""}
      ${text.trim() ? `<div style="margin-top:8px;">${text}</div>` : ""}
      <div style="text-align:right; font-size:11px; opacity:.65; margin-top:8px;">${hhmm(createdAt)}</div>
    `;

    if(atts.length){
      box.querySelector(".attwrap").appendChild(renderAttachmentsGallery(atts));
    }

    return box;
  }

  async function loadComments({silent=false} = {}){
  try{
    if(!silent) cState.textContent = "Cargando…";

    const raw = await API.getTaskComments(taskId, 50);
    const list = Array.isArray(raw) ? raw : (raw.comments || []);
    cList.innerHTML = "";

    if(!list.length){
      cState.textContent = silent ? "" : "Aún no hay comentarios.";
    } else {
      cState.textContent = "";
      for(const c of list) cList.appendChild(renderComment(c));
      cList.scrollTop = cList.scrollHeight;
    }
  }catch(e){
    cState.textContent = e.message || String(e);
  }
}

  cAttach.addEventListener("click", ()=>{
    const tmp = document.createElement("input");
    tmp.type = "file";
    tmp.multiple = true;
    tmp.onchange = () => {
      const files = Array.from(tmp.files || []);
      for(const f of files){
        const url = URL.createObjectURL(f);
        pending.push({
          file: f, url,
          name: f.name, size: f.size, mime: f.type,
          isImage: isImageMime(f.type) || guessIsImageByName(f.name),
        });
      }
      renderPending();
    };
    tmp.click();
  });

  cText.addEventListener("keydown", (e)=>{
    if(e.key === "Enter"){
      e.preventDefault();
      cSend.click();
    }
  });

  cSend.addEventListener("click", async ()=>{
    const text = cText.value.trim();
    if(sending) return;
    if(!text && !pending.length) return;

    sending = true;
    cSend.disabled = true;
    cAttach.disabled = true;
    cState.textContent = "Enviando…";

    try{
      const files = pending.map(p => p.file);
      cText.value = "";
      await API.postTaskComment({ taskId, text, files });

      for(const a of pending){ try{ URL.revokeObjectURL(a.url); }catch(_){} }
      pending = [];
      renderPending();

      await loadComments();
    }catch(e){
      cState.textContent = e.message || String(e);
    }finally{
      sending = false;
      cSend.disabled = false;
      cAttach.disabled = false;
    }
  });

  await loadComments();
  poll = setInterval(() => loadComments({ silent:true }), 3500);
}

function renderTaskTile(t, {showHistory=false}){
  const done = String(t.status||"").toUpperCase()==="DONE";
  const canArchive = !showHistory && done;
  const canDelete = showHistory; // ✅ solo historial

  const tile = document.createElement("div");
  tile.className = "tasktile";
  const color = String(t.color || "gray");
  tile.dataset.color = color;
  tile.classList.add(`task-${color}`);


  const left = document.createElement("div");
  left.className = "taskleft";

  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = done;
  cb.className = "taskcheck";
  cb.addEventListener("change", async () => {
    try{
      await toggleTask(t.id || t._id, cb.checked);
      await loadDashboard();
    }catch(e){
      alert("Error actualizando tarea: " + (e.message || String(e)));
      cb.checked = !cb.checked;
    }
  });

  left.appendChild(cb);

  const body = document.createElement("div");
  body.className = "taskbody";

  // top row: pill + archive
  const top = document.createElement("div");
  top.className = "tasktop";

  const pill = document.createElement("div");
  pill.className = `pillstatus ${done ? "done" : "pending"}`;
  pill.textContent = done ? "Hecha" : "Pendiente";

  top.appendChild(pill);

  // 🎨 color (siempre)
const pal = document.createElement("button");
pal.className = "btn tiny";
pal.innerHTML = "🎨";
pal.addEventListener("click", async (e) => {
  e.stopPropagation();
  openColorPicker(t, async (picked) => {
    if (!picked || picked === t.color) return;
    try {
      await API.updateTask(t.id || t._id, { color: picked });
      await loadDashboard();
    } catch (err) {
      alert("Error cambiando color: " + (err.message || String(err)));
    }
  });
});
top.appendChild(pal);

  if(canArchive){
    const arch = document.createElement("button");
    arch.className = "btn tiny";
    arch.innerHTML = `🗄️ Historial`;
    arch.addEventListener("click", async (e) => {
      e.stopPropagation();
      try{
        await archiveTask(t.id||t._id);
        await loadDashboard();
      }catch(err){
        alert("Error enviando a historial: " + (err.message || String(err)));
      }
    });
    top.appendChild(arch);
  }

  if (canDelete) {
  const del = document.createElement("button");
  del.className = "btn tiny";
  del.style.border = "1px solid rgba(185,28,28,.35)";
  del.style.color = "#b91c1c";
  del.innerHTML = `🗑️ Borrar`;
  del.addEventListener("click", async (e) => {
    e.stopPropagation();
    const ok = confirm(`¿Borrar definitivamente "${t.title || "tarea"}"?`);
    if (!ok) return;
    try {
      await API.deleteTask(t.id || t._id); // ✅ usa la nueva función
      await loadDashboard();
    } catch (err) {
      alert("Error borrando tarea: " + (err.message || String(err)));
    }
  });
  top.appendChild(del);
}

  body.appendChild(top);

  // title
  const title = document.createElement("div");
  title.className = `tasktitle ${done ? "lined" : ""}`;
  title.textContent = t.title || t.text || "Tarea";
  body.appendChild(title);

  // subtitle
  const sub = document.createElement("div");
  sub.className = "tasksub";
  sub.textContent = `${dueText(t)} • Responsable: ${assigneeName(t)}`;
  body.appendChild(sub);

  // completedAt
  if(done && t.completedAt){
    const comp = document.createElement("div");
    comp.className = "taskcomp";
    comp.textContent = `Completada: ${ddmmyyhhmm(t.completedAt)}`;
    body.appendChild(comp);
  }

  // attachments (max 2)
  const atts = taskAttachments(t);
if(atts.length){
  const row = document.createElement("div");
  row.className = "taskatts";

  const show = atts.slice(0,2);
  for(const a of show){
    const u = toLocalPath(fullUrl(a.url));

    if(isImageAtt(a)){
      const img = document.createElement("img");
      img.className = "attimg";
      img.src = u;
      img.alt = a.name || "img";
      img.addEventListener("click", (e)=>{ e.stopPropagation(); openUrl(u); });
      row.appendChild(img);
    }else{
      const chip = document.createElement("div");
      chip.className = "attfile";
      chip.innerHTML = `📎 <span>${(a.name||"Archivo")}</span>`;
      chip.addEventListener("click", (e)=>{ e.stopPropagation(); openUrl(u); });
      row.appendChild(chip);
    }
  }

  if(atts.length > 2){
    const more = document.createElement("div");
    more.className = "attmore";
    more.textContent = `+${atts.length-2} más`;
    row.appendChild(more);
  }

  body.appendChild(row);
}


  tile.appendChild(left);
  tile.appendChild(body);

  // ✅ Abrir comentarios al clicar en la tarea (pero no en checkbox/archivar/adjuntos)
tile.style.cursor = "pointer";

tile.addEventListener("click", (e) => {
  // no abrir si clicas checkbox, botones o adjuntos
  if (
    e.target?.classList?.contains("taskcheck") ||
    e.target?.closest("button") ||
    e.target?.closest(".attimg") ||
    e.target?.closest(".attfile") ||
    e.target?.closest(".attmore")
  ) return;

  openTaskCommentsModal({
    taskId: String(t.id || t._id || ""),
    title: t.title || t.text || "Tarea",
    taskAttachments: taskAttachments(t), // ✅ ya normalizados
  });
});

  return tile;
}

function renderSection({mountId, title, subtitle, progressValue, showProgress, tasks, emptyText, showHistory, sectionKey}){
  const mount = document.getElementById(mountId);
  if(!mount) return;

  mount.innerHTML = "";

  const head = document.createElement("div");
  head.className = "sechead";

  const meta = document.createElement("div");
  meta.className = "secmeta";

  const h = document.createElement("div");
  h.className = "sectitle";
  h.textContent = title;

  const s = document.createElement("div");
  s.className = "secsub";
  s.textContent = subtitle;

  meta.appendChild(h);
  meta.appendChild(s);

  head.appendChild(meta);

  if(showProgress){
    const p = document.createElement("div");
    p.className = "progressring";
    const pctVal = Math.round((progressValue||0)*100);
    p.innerHTML = `
      <svg viewBox="0 0 36 36" class="ring">
        <path class="ringbg"
          d="M18 2.0845
             a 15.9155 15.9155 0 0 1 0 31.831
             a 15.9155 15.9155 0 0 1 0 -31.831"/>
        <path class="ringfg"
          stroke-dasharray="${pctVal}, 100"
          d="M18 2.0845
             a 15.9155 15.9155 0 0 1 0 31.831
             a 15.9155 15.9155 0 0 1 0 -31.831"/>
      </svg>
      <div class="ringtxt">${pctVal}%</div>
    `;
    head.appendChild(p);
  }

  const body = document.createElement("div");
  body.className = "secbody";

  let collapsed = false;

head.style.cursor = "pointer";
head.addEventListener("click", (e) => {
  if (e.target.closest("button")) return; // no plegar si clicas un botón
  collapsed = !collapsed;
  body.style.display = collapsed ? "none" : "";
});

  mount.appendChild(head);

  if(!tasks.length){
    const em = document.createElement("div");
    em.className = "state";
    em.textContent = emptyText;
    body.appendChild(em);
  }else{
    for (const t of tasks) {
  const tile = renderTaskTile(t, { showHistory });

  // ✅ Drag only en TAREAS (no historial)
  if (!showHistory) {
    tile.draggable = true;
    tile.dataset.taskId = String(t.id || t._id || "");
    tile.dataset.sectionKey = sectionKey;
    tile.classList.add("draggable");
  }

  body.appendChild(tile);
}
  }

  mount.appendChild(body);
  // ✅ instala drag sobre el body de esta sección
if (!showHistory) {
  installDragForSection(body, sectionKey);
}
}

let dragSrc = null;

function installDragForSection(containerEl, sectionKey) {
  if (!containerEl) return;

  containerEl.addEventListener("dragstart", (e) => {
    const tile = e.target.closest(".tasktile.draggable");
    if (!tile) return;
    dragSrc = tile;
    e.dataTransfer.effectAllowed = "move";
    tile.classList.add("dragging");
  });

  containerEl.addEventListener("dragend", (e) => {
    const tile = e.target.closest(".tasktile.draggable");
    if (tile) tile.classList.remove("dragging");
    dragSrc = null;
  });

  containerEl.addEventListener("dragover", (e) => {
    if (!dragSrc) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";

    const over = e.target.closest(".tasktile.draggable");
    if (!over || over === dragSrc) return;

    const rect = over.getBoundingClientRect();
    const after = (e.clientY - rect.top) > rect.height / 2;
    over.parentNode.insertBefore(dragSrc, after ? over.nextSibling : over);
  });

  containerEl.addEventListener("drop", async (e) => {
    if (!dragSrc) return;
    e.preventDefault();

    // guarda orden en backend
    try {
      const ids = Array.from(containerEl.querySelectorAll(".tasktile.draggable"))
        .map((el) => el.dataset.taskId)
        .filter(Boolean);

      await API.saveTaskOrder(sectionKey, ids);
    } catch (err) {
      console.warn("No se pudo guardar orden:", err);
      // si falla, recarga desde server para “reparar”
      await loadDashboard();
    }
  });
}

async function loadDashboard(){
  const state = $("dashState");
  state.textContent = "Cargando…";

  try{
    // ⚠️ tu backend Flutter usa Api.getDashboardRaw(tab: 'TAREAS'|'HISTORIAL')
    // así que aquí lo pedimos igual:
    const data = await API.getDashboard(dashTab); // 👈 ver api.js abajo
    const mine = (data.mine || []).slice();
    const assigned = (data.assignedByMe || []).slice();

    const showHistory = dashTab === "HISTORIAL";

    if(showHistory){
  // en historial no tiene sentido "pendientes", lo ocultamos
  setKpis({ visible:false });
} else {
  setKpis({
    minePending: pendingCount(mine),
    assignedPending: pendingCount(assigned),
    visible:true
  });
}

    state.textContent = "";

    const pMine = showHistory ? 0 : progress(mine);
    const pAssigned = showHistory ? 0 : progress(assigned);

    renderSection({
      mountId: "secMine",
      sectionKey: "pending",
      title: "Pendientes",
      subtitle: showHistory ? "Completadas (archivadas o pasadas 24h)" : "Pendientes + completadas últimas 24h",
      progressValue: pMine,
      showProgress: !showHistory,
      tasks: mine,
      emptyText: showHistory ? "No hay historial aún." : "No tienes tareas ahora mismo.",
      showHistory
    });

    renderSection({
      mountId: "secAssigned",
      sectionKey: "requested",
      title: "Solicitadas",
      subtitle: showHistory ? "Completadas (archivadas o pasadas 24h)" : "Pendientes + completadas últimas 24h",
      progressValue: pAssigned,
      showProgress: !showHistory,
      tasks: assigned,
      emptyText: showHistory ? "No hay historial aún." : "No has pedido tareas ahora mismo.",
      showHistory
    });

  }catch(e){
    state.textContent = e.message || String(e);
  }
}

function toLocalPath(url){
  if (!url) return "";
  try {
    const u = new URL(url);
    return u.pathname; // 👉 "/uploads/xxx.jpg"
  } catch {
    return url; // ya es "/uploads/..."
  }
}

  // ------- PROFILE
  async function renderProfile(){
    const el = $("meCard");

let meRes;
try {
  meRes = await API.me();              // ✅ siempre fresco
} catch(e){
  el.innerHTML = `<div class="state">No se pudo cargar tu perfil.</div>`;
  return;
}

ME = meRes.user || meRes;              // tu backend devuelve { user: ... }

const name = ME.name || "";
const status = (ME.status || "DISPONIBLE").toUpperCase();
const photo = fullUrl(ME.photoUrlFull || ME.photoUrl || ""); // ✅ igual que Flutter

    el.innerHTML = `
      <div class="row" style="align-items:flex-start;">
        <div class="avatar" style="width:64px;height:64px;">
          ${photo ? `<img src="${photo}" alt="avatar">` : (name?.[0]?.toUpperCase() || "?")}
        </div>

        <div style="flex:1;">
          <div style="font-weight:1000;font-size:18px;">${escapeHtml(name || "Usuario")}</div>
          <div style="color:rgba(0,0,0,.55);font-weight:800;margin-top:4px;">
            ${escapeHtml(ME.email || "")}
          </div>
        </div>
      </div>

      <div style="height:12px"></div>

      <div class="field">
  <label>Nombre</label>
  <input class="input" id="pName" value="${escapeAttr(name)}" />
</div>

<div class="field">
  <label>Estado</label>
  <select class="input" id="pStatus">
    <option value="DISPONIBLE">Disponible</option>
    <option value="OCUPADO">Ocupado</option>
  </select>
</div>

<div class="field">
  <label>Foto (opcional)</label>
  <input id="pAvatar" type="file" accept="image/*" />
</div>

<div class="row right">
  <button class="btn primary" id="pSave">Guardar</button>
</div>



      <div id="pState" class="state"></div>
    `;

    document.getElementById("pStatus").value = status;

    document.getElementById("pSave").addEventListener("click", async () => {
      const pState = document.getElementById("pState");
      pState.textContent = "Guardando…";

      const newName = document.getElementById("pName").value.trim();
      const newStatus = document.getElementById("pStatus").value;

      try{
        // 1) datos
        await API.updateMe({ name: newName, status: newStatus });
        // refresca ME
        const meRes = await API.me();
        ME = meRes.user || meRes;
        const MY_ID = String(ME.id || ME._id);

        // 2) avatar (si hay)
        const avatarEl = document.getElementById("pAvatar");
const file = avatarEl?.files?.[0];
if(file){
  await API.uploadMePhoto(file); // ✅ POST /me/photo con field "photo"
}

        pState.textContent = "Guardado ✅";
        // re-render para refrescar foto
        await renderProfile();
        // si estás en chats, refresca para ver photoUrl en lista
        await loadChats({showSpinner:false});
      }catch(e){
        pState.textContent = e.message || String(e);
      }
    });
  }

  function escapeHtml(s){
    return String(s ?? "")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }
  function escapeAttr(s){ return escapeHtml(s).replaceAll("\n"," "); }

  // ------- start
  setView("chats");
  await loadChats({showSpinner:true});
  chatsPoll = setInterval(() => loadChats({showSpinner:false}), 3000);
});
