// public/chat.js
document.addEventListener("DOMContentLoaded", async () => {
  const API = window.DONE_API;

    // ---- state (DECLARAR ANTES DE USAR)
  let ME = null;

  let CHAT = null;
  let CHAT_MEMBERS = []; // [{id,name,email,photoUrl,status}]
  let selectedAssigneeIds = []; // ids seleccionados para la tarea

  let sending = false;
  let polling = null;
  let lastRenderKey = "";
  let attachments = []; // {file, url, isImage, name, size, mime}

  let __chatFilesModal = null;


  // ---- DOM
  const elState = document.getElementById("chatState");
  const elList = document.getElementById("messages");
  const elTitle = document.getElementById("chatTitle");
  const elTitleBtn = document.getElementById("chatTitleBtn") || elTitle;
  const backBtn = document.getElementById("backBtn");
  const logoutBtn = document.getElementById("logout");
  const buzzBtn = document.getElementById("buzzBtn");

  const clipBtn = document.getElementById("clipBtn");
  const taskBtn = document.getElementById("taskBtn");
  const sendBtn = document.getElementById("sendBtn");
  const textInput = document.getElementById("textInput");
  const fileInput = document.getElementById("fileInput");

  const attachBar = document.getElementById("attachBar");

  // image modal
  const imgModal = document.getElementById("imgModal");
  const imgModalEl = document.getElementById("imgModalEl");
  const imgClose = document.getElementById("imgClose");
  const imgOpen = document.getElementById("imgOpen");
  let imgCurrentUrl = "";

  // ---- routing params
  const sp = new URLSearchParams(location.search);
  const chatId = sp.get("chatId") || "";
  const title = sp.get("title") || "Chat";
  if (!chatId) {
    elState.textContent = "Falta chatId en la URL.";
    return;
  }
  const chatType = (sp.get("type") || "").toUpperCase(); // "DM" | "GROUP"
  const isGroupChat = chatType === "GROUP";

  elTitle.textContent = title;

  elTitleBtn?.addEventListener("click", () => {
  openChatFilesModal();
  });


    // ---- session
  try {
    const meRes = await API.me();
    ME = meRes.user || meRes;
  } catch (e) {
    location.href = "/login";
    return;
  }
    // ---- load chat members (para asignar responsable en GROUP)
  try {
    const rawChat = await getChat();
    CHAT = rawChat.chat || rawChat;
    CHAT_MEMBERS = (CHAT.members || []).map(m => ({
      id: String(m._id || m.id),
      name: m.name || "",
      email: m.email || "",
      photoUrl: m.photoUrl || null,
      status: m.status || "",
    }));
  } catch (e) {
    console.warn("No pude cargar chat:", e);
    CHAT_MEMBERS = [];
  }

  logoutBtn?.addEventListener("click", () => {
    API.clearToken();
    location.href = "/";
  });

  backBtn?.addEventListener("click", () => {
    location.href = "/app";
  });

  buzzBtn?.addEventListener("click", () => {
    alert(`Zumbido\n\nVibración a ${title} durante 10 segundos\n(pendiente de activar)`);
  });

  // ---- API endpoints (con tu backend)
  async function getMessages() {
    return API.api(`/chats/${encodeURIComponent(chatId)}/messages`);
  }

    async function getChat() {
    return API.api(`/chats/${encodeURIComponent(chatId)}`);
  }

  async function getChatFiles() {
  return API.api(`/chats/${encodeURIComponent(chatId)}/files`);
  }

  async function uploadGroupPhoto(file) {
  const token = API.getToken();
  const form = new FormData();
  form.append("photo", file); // 👈 campo EXACTO que espera el backend

  const res = await fetch(`/chats/${encodeURIComponent(chatId)}/photo`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || `Request failed (${res.status})`);
  return data; // { ok:true, photoUrl:"/uploads/chat-photos/..." }
  }


  async function sendText(text) {
    return API.api(`/chats/${encodeURIComponent(chatId)}/messages`, {
      method: "POST",
      body: JSON.stringify({ text }),
    });
  }

  async function sendFiles({ text, files }) {
    console.log("UPLOAD files:", files.map(f => `${f.name} ${f.size}`));
    const token = API.getToken();
    const form = new FormData();
    if (text) form.append("text", text);
    for (const f of files) form.append("files", f);

    const res = await fetch(`/chats/${encodeURIComponent(chatId)}/messages/files`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || data.message || `Request failed (${res.status})`);
    return data;
  }

  async function sendTask({ title, dueDate, files, assigneeIds }) {
  const token = API.getToken();
  const form = new FormData();
  form.append("title", title);
  if (dueDate) form.append("dueDate", dueDate); // ISO string

  // ✅ NUEVO: assigneeIds (multipart -> enviamos JSON string)
  if (assigneeIds && assigneeIds.length) {
    form.append("assigneeIds", JSON.stringify(assigneeIds));
  }

  for (const f of files) form.append("files", f);

  const res = await fetch(`/chats/${encodeURIComponent(chatId)}/tasks`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || `Request failed (${res.status})`);
  return data;
}

async function toggleTask(taskId){
  return API.api(`/tasks/${encodeURIComponent(taskId)}/toggle`, {
    method: "PATCH",
    body: JSON.stringify({}),
  });
}



  // ---- helpers
  function hhmm(dateStrOrDate) {
    const d = dateStrOrDate instanceof Date ? dateStrOrDate : new Date(dateStrOrDate);
    const h = String(d.getHours()).padStart(2, "0");
    const m = String(d.getMinutes()).padStart(2, "0");
    return `${h}:${m}`;
  }

  function esc(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function isImageMime(m) {
    const v = String(m || "").toLowerCase();
    return v.startsWith("image/");
  }

  function guessIsImageByName(name) {
    const n = String(name || "").toLowerCase();
    return n.endsWith(".png") || n.endsWith(".jpg") || n.endsWith(".jpeg") || n.endsWith(".webp") || n.endsWith(".gif");
  }

  function prettySize(bytes) {
    const b = Number(bytes || 0);
    if (!b) return "";
    const kb = 1024;
    const mb = 1024 * 1024;
    if (b >= mb) return `${(b / mb).toFixed(1)} MB`;
    if (b >= kb) return `${Math.round(b / kb)} KB`;
    return `${b} B`;
  }
  function absUrl(u) {
  const s = String(u || "").trim();
  if (!s) return "";
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  // normaliza "uploads/.." -> "/uploads/.."
  const path = s.startsWith("/") ? s : `/${s}`;
  return `${location.origin}${path}`;
  }

  function toLocalPath(url){
  const s = String(url || "").trim();
  if(!s) return "";
  try{
    // si es absoluta (http/https), nos quedamos con pathname
    const u = new URL(s);
    return u.pathname + (u.search || "");
  }catch(_){
    // si ya es relativa
    return s.startsWith("/") ? s : `/${s}`;
  }
}

// para abrir en nueva pestaña sí conviene absoluta a TU ORIGIN
function openableUrl(url){
  const p = toLocalPath(url);
  return `${location.origin}${p}`;
}

  function scrollToBottom({ smooth = false } = {}) {
    if (!elList) return;
    if (!smooth) {
      elList.scrollTop = elList.scrollHeight;
    } else {
      elList.scrollTo({ top: elList.scrollHeight, behavior: "smooth" });
    }
  }

  function openImage(url) {
  const local = toLocalPath(url);
  const openUrl = openableUrl(url); // absoluta
  imgCurrentUrl = openUrl;
  imgTagSet(local); // el <img> del modal usa local
  imgModal.classList.remove("hidden");
}


  function imgTagSet(url) {
    imgModalEl.src = url;
    imgModalEl.onerror = () => {
      imgModalEl.src = "";
    };
  }

  async function openTaskCommentsModal({ taskId, title, taskAttachments = [] }){
  if(!taskId) return;

  // overlay
  const modal = document.createElement("div");
  modal.className = "imgmodal";
  modal.innerHTML = `
    <div class="imgmodal-top" style="justify-content:space-between;">
      <div style="font-weight:900">Comentarios</div>
      <button class="iconbtn" id="cClose">✕</button>
    </div>

    <div class="imgmodal-body" style="background:#fff; padding:14px; border-radius:14px; max-width:760px; margin:0 auto;">
      <div style="font-weight:900; margin-bottom:10px;">${esc(title || "Tarea")}</div>

      <div class="card" id="cTaskCard" style="margin-bottom:12px; display:none;">
  <div style="font-weight:900;margin-bottom:10px;">Archivos de la tarea</div>
  <div id="cTaskAtts"></div>
</div>


      <div id="cState" class="state" style="margin:6px 0;"></div>
      <div id="cList" style="max-height:48vh; overflow:auto; padding-right:6px;"></div>

      <div id="cPending" style="margin-top:10px;"></div>

      <div class="row" style="gap:8px; margin-top:10px;">
        <button class="btn outline" id="cAttach" type="button">📎</button>
        <input id="cText" class="composer-input" placeholder="Escribe un comentario…" style="flex:1;" />
        <button class="btn primary" id="cSend" type="button">Enviar</button>
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
  const cPending = modal.querySelector("#cPending");
  const cTaskAtts = modal.querySelector("#cTaskAtts");

  let sendingC = false;
  let pending = []; // {file, url, isImage, name, size, mime}
  let poll = null;

  const close = () => {
    try { clearInterval(poll); } catch(_){}
    // limpia objectURLs
    for(const a of pending){ try{ URL.revokeObjectURL(a.url); }catch(_){} }
    pending = [];
    modal.remove();
  };

  cClose.addEventListener("click", close);
  modal.addEventListener("click", (e)=>{ if(e.target === modal) close(); });

  async function renderTopTaskAttachments(){
  if(!cTaskAtts) return;

  // 1) usamos lo que venga desde chat (si viene)
  let atts = Array.isArray(taskAttachments) ? taskAttachments : [];

  // 2) fallback: si no vienen, pedimos la tarea al backend
  if(!atts.length){
    try{
      const rawTask = await API.getTask(taskId);
      const task = rawTask.task || rawTask;

      if (Array.isArray(task?.attachments)) {
        atts = task.attachments.map(a => ({
          url: toLocalPath(a.url),
          name: a.name || "Archivo",
          mime: a.mime || "",
          size: a.size || 0,
          isImage: isImageMime(a.mime) || guessIsImageByName(a.name) || guessIsImageByName(a.url),
        }));
      }
    }catch(_){
      // si falla, no pasa nada: simplemente no mostramos adjuntos
    }
  }

  if(!atts.length) return;

  const wrap = document.createElement("div");
  wrap.appendChild(renderAttachmentsGallery(atts));
  cTaskAtts.appendChild(wrap);
}

// render task attachments (arriba)
await renderTopTaskAttachments();


  function renderPending(){
    if(!cPending) return;
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
      show.map((a, i) => `
        <div class="attchip" style="position:relative;">
          ${a.isImage ? `<img src="${a.url}" alt="">` : `<div class="attname">${esc(a.name)}</div>`}
          <button class="attx" data-i="${i}" style="position:absolute; top:-8px; right:-8px;">✕</button>
        </div>
      `).join("") +
      (pending.length > 2 ? `<div class="attmore">+${pending.length-2} más</div>` : "") +
      `</div>`;

    cPending.querySelectorAll(".attx").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const idx = Number(btn.dataset.i);
        const a = pending[idx];
        try{ URL.revokeObjectURL(a.url); }catch(_){}
        pending.splice(idx, 1);
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
      url: toLocalPath(a.url),
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
      <div style="font-weight:900;font-size:12px;">${esc(senderName)}</div>
      ${atts.length ? `<div class="attwrap" style="margin-top:8px;"></div>` : ""}
      ${text.trim() ? `<div style="margin-top:8px;">${esc(text)}</div>` : ""}
      <div style="text-align:right; font-size:11px; opacity:.65; margin-top:8px;">${hhmm(createdAt)}</div>
    `;

    if(atts.length){
      box.querySelector(".attwrap").appendChild(renderAttachmentsGallery(atts));
    }

    return box;
  }

  async function loadComments(){
    try{
      cState.textContent = "Cargando…";
      const raw = await API.getTaskComments(taskId, 50);
      const list = Array.isArray(raw) ? raw : (raw.comments || raw.items || []);
      cList.innerHTML = "";
      if(!list.length){
        cState.textContent = "Aún no hay comentarios.";
      }else{
        cState.textContent = "";
        for(const c of list) cList.appendChild(renderComment(c));
        // scroll bottom
        cList.scrollTop = cList.scrollHeight;
      }
    }catch(e){
      cState.textContent = e.message || String(e);
    }
  }

  // adjuntar (usa input temporal para no mezclarse con chat)
  cAttach.addEventListener("click", ()=>{
    const tmp = document.createElement("input");
    tmp.type = "file";
    tmp.multiple = true;
    tmp.accept = "*/*";
    tmp.onchange = () => {
      const files = Array.from(tmp.files || []);
      for(const f of files){
        const url = URL.createObjectURL(f);
        pending.push({
          file: f,
          url,
          name: f.name,
          size: f.size,
          mime: f.type,
          isImage: isImageMime(f.type) || guessIsImageByName(f.name),
        });
      }
      renderPending();
    };
    tmp.click();
  });

  cSend.addEventListener("click", async ()=>{
    const text = cText.value.trim();
    if(sendingC) return;
    if(!text && !pending.length) return;

    sendingC = true;
    cSend.disabled = true;
    cAttach.disabled = true;
    cState.textContent = "Enviando…";

    try{
      const files = pending.map(p => p.file);
      cText.value = "";
      await API.postTaskComment({ taskId, text, files });

      // limpia pending
      for(const a of pending){ try{ URL.revokeObjectURL(a.url); }catch(_){} }
      pending = [];
      renderPending();

      await loadComments();
    }catch(e){
      cState.textContent = e.message || String(e);
    }finally{
      sendingC = false;
      cSend.disabled = false;
      cAttach.disabled = false;
    }
  });

  // start
  await loadComments();
  poll = setInterval(loadComments, 3500);
}

  imgClose?.addEventListener("click", () => imgModal.classList.add("hidden"));
  imgModal?.addEventListener("click", (e) => { if (e.target === imgModal) imgModal.classList.add("hidden"); });
  imgOpen?.addEventListener("click", () => { if (imgCurrentUrl) window.open(imgCurrentUrl, "_blank"); });


  async function openChatFilesModal(){
  // overlay
  const modal = document.createElement("div");
    modal.className = "imgmodal";
  modal.innerHTML = `
  <div class="modal-card">
    <div class="modal-head">
      <div class="modal-title">Archivos</div>
      <button class="iconbtn" id="fClose">✕</button>
    </div>

    <div class="modal-body">
      ${
        isGroupChat
          ? `
        <div class="group-photo-box" id="gpBox">
          <div class="gp-left">
            <div class="gp-title">Grupo</div>
            <div class="gp-sub">Administra la foto y los miembros</div>
          </div>

          <div class="gp-right" style="display:flex; gap:10px; align-items:center;">
            <div class="gp-avatar" id="gpAvatar"></div>
            <button class="btn outline" id="gpChange" type="button">Cambiar foto</button>
            <input id="gpInput" type="file" accept="image/*" style="display:none;" />
          </div>
        </div>

        <div class="group-actions" style="display:flex; gap:10px; flex-wrap:wrap; margin-top:10px;">
          <button class="btn outline" id="gmAdd" type="button">➕ Añadir participantes</button>
          <button class="btn danger" id="gmLeave" type="button">🚪 Salir del grupo</button>
        </div>

        <div style="height:12px;"></div>
      `
          : ""
      }

      <div id="fState" class="state" style="margin:6px 0;">Cargando…</div>
      <div id="fList"></div>
    </div>
  </div>
`;
       
  document.body.appendChild(modal);
  console.log("openChatFilesModal: isGroupChat=", isGroupChat, "chatType=", chatType, "chatId=", chatId);
    __chatFilesModal = modal;

    // ===============================
// ACCIONES DE GRUPO (AÑADIR / SALIR)
// ===============================
if (isGroupChat) {
  const btnAdd = modal.querySelector("#gmAdd");
  const btnLeave = modal.querySelector("#gmLeave");

  if (!btnAdd || !btnLeave) {
    console.warn("Botones de grupo no encontrados");
  }

  // ➕ AÑADIR PARTICIPANTES
  btnAdd?.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();

    try {
      await openAddMembersModal(); // 👈 YA LA TIENES DEFINIDA ABAJO
    } catch (err) {
      alert(err.message || String(err));
    }
  });

  // 🚪 SALIR DEL GRUPO
  btnLeave?.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();

    const ok = confirm("¿Seguro que quieres salir del grupo?");
    if (!ok) return;

    try {
      btnLeave.disabled = true;
      btnLeave.textContent = "Saliendo…";

      await API.leaveGroup(chatId); // PATCH /chats/:id/leave

      // vuelve al listado de chats
      location.href = "/app";
    } catch (err) {
      alert(err.message || String(err));
    } finally {
      btnLeave.disabled = false;
      btnLeave.textContent = "🚪 Salir del grupo";
    }
  });
   }

   const fClose = modal.querySelector("#fClose");
   const fState = modal.querySelector("#fState");
   const fList  = modal.querySelector("#fList");

    // --- GROUP PHOTO UI (solo grupos)
     if (isGroupChat) {
     const gpAvatar = modal.querySelector("#gpAvatar");
     const gpChange = modal.querySelector("#gpChange");
     const gpInput = modal.querySelector("#gpInput");

     function paintGroupAvatar(url) {
      if (!gpAvatar) return;

      const photo = url || CHAT?.photoUrl || null;
      if (photo) {
        gpAvatar.innerHTML = `<img src="${toLocalPath(photo)}" alt="grupo" />`;
      } else {
        // fallback: inicial del título
        const initial = (String(title || "G").trim()[0] || "G").toUpperCase();
        gpAvatar.innerHTML = `<div class="gp-letter">${esc(initial)}</div>`;
      }
    }

    paintGroupAvatar(CHAT?.photoUrl);

    gpChange?.addEventListener("click", () => gpInput?.click());

    gpInput?.addEventListener("change", async () => {
      const file = gpInput.files && gpInput.files[0];
      gpInput.value = "";
      if (!file) return;

      try {
        gpChange.disabled = true;
        gpChange.textContent = "Subiendo…";

        const out = await uploadGroupPhoto(file); // { photoUrl }
        // actualiza en memoria
        CHAT = { ...(CHAT || {}), photoUrl: out.photoUrl };

        // repinta preview
        paintGroupAvatar(out.photoUrl);

        // opcional: si tienes avatar del topbar (si existe)
        const topAvatar = document.getElementById("chatAvatar");
        if (topAvatar) {
          topAvatar.innerHTML = `<img src="${toLocalPath(out.photoUrl)}" alt="grupo" />`;
        }
      } catch (e) {
        alert("No se pudo actualizar la foto: " + (e.message || String(e)));
      } finally {
        gpChange.disabled = false;
        gpChange.textContent = "Cambiar";
      }
    });
  }

    const close = () => {
    try { if (__chatFilesModal === modal) __chatFilesModal = null; } catch(_) {}
    modal.remove();
  };
  fClose.addEventListener("click", close);
  modal.addEventListener("click", (e)=>{ if(e.target === modal) close(); });

  function renderFileTile(a){
    const url = a.url || "";
    const name = a.name || "Archivo";
    const mime = a.mime || "";
    const size = a.size || 0;

    const isImg = isImageMime(mime) || guessIsImageByName(name) || guessIsImageByName(url);
    const isPdf = String(mime).toLowerCase() === "application/pdf" || String(name).toLowerCase().endsWith(".pdf");

    // normaliza url para abrirla
    const openUrl = openableUrl(url);

    if(isImg){
      const cell = document.createElement("div");
      cell.className = "imgcell";
      const img = document.createElement("img");
      img.src = toLocalPath(url);
      img.alt = name;
      cell.appendChild(img);
      cell.addEventListener("click", ()=> openImage(openUrl));
      return cell;
    }

    const row = document.createElement("div");
    row.className = "filetile";
    row.innerHTML = `
      <div class="fileicon">${isPdf ? "PDF" : "FILE"}</div>
      <div class="filemeta">
        <div class="filename">${esc(name)}</div>
        <div class="filesize">${esc(prettySize(size))}</div>
      </div>
      <div class="fileopen">↗</div>
    `;
    row.addEventListener("click", ()=> window.open(openUrl, "_blank"));
    return row;
  }

  try{
    const raw = await getChatFiles();

    // esperamos { files: [...] } o directamente [...]
    const files = Array.isArray(raw) ? raw : (raw.files || []);
    if(!files.length){
      fState.textContent = "No hay archivos en este chat.";
      fList.innerHTML = "";
      return;
    }

    fState.textContent = "";

    // separa imágenes y ficheros
    const imgs = files.filter(a => {
      const u = a?.url || "";
      const n = a?.name || "";
      const m = a?.mime || "";
      return isImageMime(m) || guessIsImageByName(n) || guessIsImageByName(u);
    });

    const docs = files.filter(a => !imgs.includes(a));

    // grid de imágenes
    if(imgs.length){
      const grid = document.createElement("div");
      grid.className = "files-grid";
      imgs.slice(0, 80).forEach(a => grid.appendChild(renderFileTile(a))); // límite sensato
      fList.appendChild(grid);
    }

    // lista de documentos
    if(docs.length){
      if(imgs.length){
        const sep = document.createElement("div");
        sep.style.height = "12px";
        fList.appendChild(sep);
      }
      docs.forEach(a => fList.appendChild(renderFileTile(a)));
    }

  }catch(e){
    fState.textContent = e.message || String(e);
  }
  }

  async function openAddMembersModal(){
  // 1) UI simple
  const modal = document.createElement("div");
  modal.className = "imgmodal";
  modal.innerHTML = `
    <div class="modal-card">
      <div class="modal-head">
        <div class="modal-title">Añadir participantes</div>
        <button class="iconbtn" id="amClose">✕</button>
      </div>

      <div class="modal-body">
        <div class="field">
          <label>Buscar por nombre o email</label>
          <input class="input" id="amQuery" placeholder="mínimo 2 letras" />
        </div>

        <div id="amState" class="state" style="margin-top:8px;"></div>
        <div id="amResults" class="list" style="margin-top:8px;"></div>

        <div class="row right" style="margin-top:12px;">
          <button class="btn primary" id="amAddBtn" disabled>Añadir (0)</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const close = () => modal.remove();
  modal.querySelector("#amClose")?.addEventListener("click", close);
  modal.addEventListener("click", (e)=>{ if(e.target === modal) close(); });

  const qEl = modal.querySelector("#amQuery");
  const state = modal.querySelector("#amState");
  const resultsEl = modal.querySelector("#amResults");
  const addBtn = modal.querySelector("#amAddBtn");

  // 2) estado
  const selected = new Map(); // id -> user
  const currentIds = new Set((CHAT_MEMBERS||[]).map(m => String(m.id)));

  function renderAddBtn(){
    addBtn.disabled = selected.size === 0;
    addBtn.textContent = `Añadir (${selected.size})`;
  }
  renderAddBtn();

  // 3) búsqueda con debounce
  let t = null;
  qEl.focus();
  qEl.addEventListener("input", ()=>{
    clearTimeout(t);
    t = setTimeout(doSearch, 250);
  });

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
      const raw = await API.searchUsers(q); // ✅ ya lo tienes en api.js
      let users = Array.isArray(raw) ? raw : (raw.users || []);

      // quita los que ya están en el grupo
      users = users.filter(u => !currentIds.has(String(u.id || u._id)));

      if(!users.length){
        state.textContent = "Sin resultados (o ya están en el grupo).";
        return;
      }
      state.textContent = "";

      for(const u of users){
        const id = String(u.id || u._id);
        const name = u.displayName || u.name || u.email || id;
        const row = document.createElement("div");
        row.className = "chatrow";
        row.style.cursor = "pointer";

        const picked = selected.has(id);

        row.innerHTML = `
          <div class="chatleft">
            <div class="avatar">${(name[0]||"U").toUpperCase()}</div>
            <div class="chatmeta">
              <div class="title">${esc(name)}</div>
              <div class="sub">${esc(u.email || "")}</div>
            </div>
          </div>
          <div class="badge">${picked ? "✔" : "Añadir"}</div>
        `;

        row.addEventListener("click", ()=>{
          if(selected.has(id)) selected.delete(id);
          else selected.set(id, u);
          // repinta badge
          row.querySelector(".badge").textContent = selected.has(id) ? "✔" : "Añadir";
          renderAddBtn();
        });

        resultsEl.appendChild(row);
      }
    }catch(e){
      state.textContent = e.message || String(e);
    }
  }

  // 4) ejecutar “añadir”
  addBtn.addEventListener("click", async ()=>{
    if(!selected.size) return;
    state.textContent = "Añadiendo…";
    addBtn.disabled = true;

    try{
      const ids = Array.from(selected.keys());

      // ✅ llama a tu endpoint PATCH /chats/:id/members
      await API.addGroupMembers(chatId, ids);

      // refresca chat y miembros en memoria
      const rawChat = await API.api(`/chats/${encodeURIComponent(chatId)}`);
      CHAT = rawChat.chat || rawChat;
      CHAT_MEMBERS = (CHAT.members || []).map(m => ({
        id: String(m._id || m.id),
        name: m.name || "",
        email: m.email || "",
        photoUrl: m.photoUrl || null,
        status: m.status || "",
      }));

      close();

      // si quieres, reabre el modal de archivos para que “se note”
      // (o simplemente deja al user continuar)
      alert("Participantes añadidos ✅");
    }catch(e){
      state.textContent = e.message || String(e);
      addBtn.disabled = false;
      renderAddBtn();
    }
  });
  }

  // ---- render message
  function normalizeAttachments(m) {
  const out = [];

  // 1) legacy single attachment
  if (m.attachment && m.attachment.url) {
    out.push({
      url: toLocalPath(m.attachment.url),
      name: m.attachment.name || "Archivo",
      mime: m.attachment.mime || "",
      size: m.attachment.size || 0,
    });
  }

  // 2) new attachments array
  if (Array.isArray(m.attachments)) {
    for (const a of m.attachments) {
      if (!a || !a.url) continue;
      out.push({
        url: toLocalPath(a.url),
        name: a.name || "Archivo",
        mime: a.mime || "",
        size: a.size || 0,
      });
    }
  }

  // 3) legacy imageUrl (solo si no estaba ya)
  if (m.imageUrl) {
    const u = toLocalPath(m.imageUrl);
    out.push({
      url: u,
      name: "image",
      mime: "image/*",
      size: 0,
    });
  }

  // ✅ DEDUPE fuerte por URL (y fallback por name+size)
  const seen = new Set();
  const deduped = [];

  for (const a of out) {
    const key = a.url || `${a.name}__${a.size}`;
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);

    deduped.push({
      ...a,
      isImage: isImageMime(a.mime) || guessIsImageByName(a.name) || guessIsImageByName(a.url),
    });
  }

  return deduped;
}

function normalizeTaskAttachments(m){
  const out = [];

  // a) si el backend te manda task populate
  if (m.task && Array.isArray(m.task.attachments)) {
    for (const a of m.task.attachments) {
      if (!a?.url) continue;
      out.push({
        url: toLocalPath(a.url),
        name: a.name || "Archivo",
        mime: a.mime || "",
        size: a.size || 0,
        isImage: isImageMime(a.mime) || guessIsImageByName(a.name) || guessIsImageByName(a.url),
      });
    }
  }

  // b) si te manda taskAttachments plano
  if (Array.isArray(m.taskAttachments)) {
    for (const a of m.taskAttachments) {
      if (!a?.url) continue;
      out.push({
        url: toLocalPath(a.url),
        name: a.name || "Archivo",
        mime: a.mime || "",
        size: a.size || 0,
        isImage: isImageMime(a.mime) || guessIsImageByName(a.name) || guessIsImageByName(a.url),
      });
    }
  }

  // c) fallback: usa los attachments del mensaje (lo que ya tienes)
  const msgAtts = normalizeAttachments(m);
  if (msgAtts.length) out.push(...msgAtts);

  // dedupe por url
  const seen = new Set();
  return out.filter(a => {
    const k = a.url || `${a.name}__${a.size}`;
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

  function fileKey(f){
  return `${f.name}__${f.size}__${f.lastModified || 0}`;
  }

  function renderAttachmentsGallery(atts) {
    const images = atts.filter(a => a.isImage);
    const files = atts.filter(a => !a.isImage);

    const wrap = document.createElement("div");
    wrap.className = "attwrap";

    // images
    if (images.length) {
      const show = images.slice(0, 4);
      const extra = images.length - show.length;

      if (show.length === 1) {
        const img = document.createElement("img");
        img.className = "imgone";
        img.src = toLocalPath(show[0].url);
        img.alt = show[0].name || "img";
        img.addEventListener("click", () => openImage(openableUrl(show[0].url)));
        wrap.appendChild(img);
      } else {
        const grid = document.createElement("div");
        grid.className = "imggrid";
        show.forEach((a, i) => {
          const cell = document.createElement("div");
          cell.className = "imgcell";
          const img = document.createElement("img");
          img.src = toLocalPath(a.url);
          img.alt = a.name || "img";
          cell.appendChild(img);

          if (i === 3 && extra > 0) {
            const over = document.createElement("div");
            over.className = "imgextra";
            over.textContent = `+${extra}`;
            cell.appendChild(over);
          }

          cell.addEventListener("click", () => openImage(openableUrl(a.url)));
          grid.appendChild(cell);
        });
        wrap.appendChild(grid);
      }
    }

    // files
    for (const f of files) {
      const row = document.createElement("div");
      row.className = "filetile";
      const isPdf = (String(f.mime).toLowerCase() === "application/pdf") || String(f.name).toLowerCase().endsWith(".pdf");

      row.innerHTML = `
        <div class="fileicon">${isPdf ? "PDF" : "FILE"}</div>
        <div class="filemeta">
          <div class="filename">${esc(f.name || "Archivo")}</div>
          <div class="filesize">${esc(prettySize(f.size))}</div>
        </div>
        <div class="fileopen">↗</div>
      `;
      row.addEventListener("click", () => window.open(openableUrl(f.url), "_blank"));
      wrap.appendChild(row);
    }

    return wrap;
  }

  function taskIdOfMessage(m){
  // preferimos explícitos
  if (m.taskId) return String(m.taskId);
  if (m.task?._id || m.task?.id) return String(m.task._id || m.task.id);

  // fallback SOLO si es TASK
  const type = String(m.type || "").toUpperCase();
  if (type === "TASK" && (m._id || m.id)) return String(m._id || m.id);

  return "";
}

// para pasar adjuntos de la tarea como hace Flutter (los del mensaje TASK)
function taskAttachmentsOfMessage(m){
  const all = [];

  // 1) adjuntos del propio mensaje (attachments / imageUrl / legacy)
  all.push(...normalizeAttachments(m));

  // 2) si el mensaje trae taskAttachments
  if (Array.isArray(m.taskAttachments)) {
    for (const a of m.taskAttachments) {
      if (!a?.url) continue;
      all.push({
        url: toLocalPath(a.url),
        name: a.name || "Archivo",
        mime: a.mime || "",
        size: a.size || 0,
        isImage: isImageMime(a.mime) || guessIsImageByName(a.name) || guessIsImageByName(a.url),
      });
    }
  }

  // 3) si el backend está populando m.task con attachments
  if (Array.isArray(m.task?.attachments)) {
    for (const a of m.task.attachments) {
      if (!a?.url) continue;
      all.push({
        url: toLocalPath(a.url),
        name: a.name || "Archivo",
        mime: a.mime || "",
        size: a.size || 0,
        isImage: isImageMime(a.mime) || guessIsImageByName(a.name) || guessIsImageByName(a.url),
      });
    }
  }

  // Dedupe por URL (o name+size)
  const seen = new Set();
  const dedup = [];
  for (const a of all) {
    const k = a.url || `${a.name}__${a.size}`;
    if (!k || seen.has(k)) continue;
    seen.add(k);
    dedup.push(a);
  }

  return dedup;
}

  function idOf(v){
  if (!v) return "";
  // si viene populate: { _id } o { id }
  if (typeof v === "object") return String(v._id || v.id || "");
  return String(v);
}

  function renderMessage(m) {
  const myId = idOf(ME?._id || ME?.id);

  // soporta senderId string, senderId object o sender populate
  const senderId =
    idOf(m.senderId) ||
    idOf(m.sender?._id || m.sender?.id);

  const isMe = myId && senderId && (myId === senderId);

  const type = String(m.type || "NORMAL").toUpperCase();
  const isTask = type === "TASK";

  // ✅ WRAPPER para alinear
  const wrap = document.createElement("div");
  wrap.className = `msgwrap ${isMe ? "me" : "other"}`;

  const bubble = document.createElement("div");
  bubble.className = `bubble ${isMe ? "me" : "other"} ${isTask ? "task" : ""}`;

  const header = document.createElement("div");
  header.className = "bub-head";

  // En GROUP: muestra nombre de quien envía (menos tú)
  // En DM: solo para el otro
  if ((isGroupChat && !isMe) || (!isGroupChat && !isMe)) {
    const name = document.createElement("div");
    name.className = "sender";
    name.textContent = m.senderName || m.sender?.displayName || m.sender?.name || "—";
    header.appendChild(name);
  }

  const content = document.createElement("div");
  content.className = "bub-body";

  // adjuntos del MENSAJE normal
  const atts = normalizeAttachments(m);

  if (isTask) {
    const done = String(m.taskStatus || "").toUpperCase() === "DONE";

    const row = document.createElement("div");
    row.className = "taskrow";
    row.innerHTML = `
      <input type="checkbox" class="taskcheck" ${done ? "checked" : ""} />
      <div class="tasktext ${done ? "done" : ""}">${esc(m.text || "")}</div>
    `;

    // evitar que click en el check dispare click de la fila
    row.querySelector(".taskcheck").addEventListener("click", (e) => {
      e.stopPropagation();
    });

    row.querySelector(".taskcheck").addEventListener("change", async (e) => {
      const taskId = m.taskId || m.task?._id || m.task?.id || m._id; // fallback
      if (!taskId) return;

      const cb = e.target;

      try {
        cb.disabled = true;
        await toggleTask(taskId);
        await load({ silent: true }); // refresca estado desde backend
      } catch (err) {
        cb.checked = !cb.checked;
        alert("Error actualizando tarea: " + (err.message || String(err)));
      } finally {
        cb.disabled = false;
      }
    });

    content.appendChild(row);

    // ✅ Adjuntos reales de la TAREA (no solo del mensaje)
    // - prioriza m.task.attachments
    // - luego m.taskAttachments
    // - luego m.attachments (fallback)
    const taskAtts = normalizeTaskAttachments(m);

    if (taskAtts.length) {
      content.appendChild(renderAttachmentsGallery(taskAtts));
    }

    // ✅ abrir comentarios al clicar en la tarea (igual que Flutter)
    row.style.cursor = "pointer";
    row.addEventListener("click", (e) => {
      if (e.target && e.target.classList && e.target.classList.contains("taskcheck")) return;

      const taskId = taskIdOfMessage(m);
      openTaskCommentsModal({
        taskId,
        title: m.text || "Tarea",
        // ✅ aquí también pasamos los adjuntos de la TAREA
        taskAttachments: taskAtts,
      });
    });

  } else {
    // NORMAL
    if (atts.length) {
      content.appendChild(renderAttachmentsGallery(atts));
      if (String(m.text || "").trim()) {
        const p = document.createElement("div");
        p.className = "msgtext";
        p.textContent = m.text;
        content.appendChild(p);
      }
    } else {
      const p = document.createElement("div");
      p.className = "msgtext";
      p.textContent = m.text || "";
      content.appendChild(p);
    }
  }

  const time = document.createElement("div");
  time.className = "bub-time";
  time.textContent = hhmm(m.createdAt || new Date());

  bubble.appendChild(header);
  bubble.appendChild(content);
  bubble.appendChild(time);

  wrap.appendChild(bubble);
  return wrap;
}

  function renderMessages(list) {
    const key = JSON.stringify(list.map(m => `${m._id || m.id}-${m.updatedAt || m.createdAt || ""}-${m.taskStatus || ""}`));
    if (key === lastRenderKey) return;
    lastRenderKey = key;

    elList.innerHTML = "";
    for (const m of list) elList.appendChild(renderMessage(m));
    scrollToBottom({ smooth: false });
  }

  // ---- load
  async function load({ silent = false } = {}) {
    if (!silent) elState.textContent = "Cargando…";
    try {
      const raw = await getMessages();
      const list = Array.isArray(raw) ? raw : (raw.messages || []);
      // orden
      list.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      elState.textContent = "";
      renderMessages(list);
    } catch (e) {
      elState.textContent = e.message || String(e);
    }
  }

  // ---- attachments UI
  function renderAttachBar() {
    if (!attachments.length) {
      attachBar.classList.add("hidden");
      attachBar.innerHTML = "";
      return;
    }
    attachBar.classList.remove("hidden");

    const html = `
      <div class="attachbar-title">Adjuntos</div>
      <div class="attachbar-row">
        ${attachments.map((a, i) => `
          <div class="attchip">
            ${a.isImage ? `<img src="${a.url}" alt="">` : `<div class="attname">${esc(a.name)}</div>`}
            <button class="attx" data-i="${i}">✕</button>
          </div>
        `).join("")}
      </div>
    `;
    attachBar.innerHTML = html;

    attachBar.querySelectorAll(".attx").forEach(btn => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.i);
        const a = attachments[idx];
        try { URL.revokeObjectURL(a.url); } catch (_) {}
        attachments.splice(idx, 1);
        renderAttachBar();
        updatePlaceholder();
      });
    });
  }

  function updatePlaceholder() {
    const has = attachments.length > 0;
    textInput.placeholder = has ? "Añade un texto (opcional)…" : "Escribe un mensaje…";
  }

  clipBtn.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", () => {
  const files = Array.from(fileInput.files || []);
  const existing = new Set(attachments.map(a => fileKey(a.file)));

  for (const f of files) {
    const k = fileKey(f);
    if (existing.has(k)) continue;
    existing.add(k);

    const url = URL.createObjectURL(f);
    attachments.push({
      file: f,
      url,
      name: f.name,
      size: f.size,
      mime: f.type,
      isImage: isImageMime(f.type) || guessIsImageByName(f.name),
    });
  }

  fileInput.value = "";
  // 🔒 dedupe final por si el navegador dispara eventos raros
const seen = new Set();
attachments = attachments.filter(a => {
  const k = fileKey(a.file);
  if (seen.has(k)) {
    try { URL.revokeObjectURL(a.url); } catch (_) {}
    return false;
  }
  seen.add(k);
  return true;
});

  renderAttachBar();
  updatePlaceholder();
});

  // task button: lo conectamos luego cuando me pases tu pantalla send_task
  taskBtn.addEventListener("click", () => {
  openTaskModal();
});

function openTaskModal() {
  // Reutilizamos los attachments actuales (como Flutter initialFiles)
  const modal = document.createElement("div");
  modal.className = "imgmodal"; // reutiliza estilo overlay
  modal.innerHTML = `
    <div class="imgmodal-top" style="justify-content:space-between;">
      <div style="font-weight:900">Enviar tarea</div>
      <button class="iconbtn" id="tClose">✕</button>
    </div>

    <div class="imgmodal-body" style="background:#fff; padding:14px; border-radius:14px; max-width:640px; margin:0 auto;">
      <div class="field">
        <label>Descripción</label>
        <textarea id="tDesc" class="composer-input" style="width:100%; min-height:90px;" placeholder="Pon la tarea..."></textarea>
      </div>

      <div class="field" style="margin-top:10px;">
        <label>Fecha límite</label>
        <input id="tDue" class="input" type="datetime-local" />
      </div>

      <div class="field" style="margin-top:10px;">
  <label>Responsable</label>

  <div id="tAssigneesWrap"></div>

  <div style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap;">
    <button class="btn outline" id="tAll" type="button">Todos</button>
    <button class="btn outline" id="tMe" type="button">Yo</button>
    <button class="btn outline" id="tClear" type="button">Limpiar</button>
  </div>

  <div style="margin-top:8px; font-size:12px; opacity:.7;" id="tAssigneesHint"></div>
</div>

      <div style="margin-top:10px;">
        <button class="btn outline" id="tAttach" type="button">📎 Adjuntar</button>
        <span style="opacity:.7; font-weight:800; margin-left:8px;" id="tAttCount"></span>
      </div>

      <div id="tAttPreview" style="margin-top:10px;"></div>

      <div class="row right" style="margin-top:12px;">
        <button class="btn primary" id="tSend" type="button">Enviar tarea</button>
      </div>

      <div id="tState" class="state" style="margin-top:10px;"></div>
    </div>
  `;

  document.body.appendChild(modal);

  // ✅ Observer se declara antes, para que close() lo pueda usar sin redeclarar variables
  let obs = null;
  let sendingTask = false;

  const close = () => {
    try { obs?.disconnect(); } catch (_) {}
    modal.remove();
  };

  // cierre
  modal.querySelector("#tClose").addEventListener("click", close);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });

  const tDesc = modal.querySelector("#tDesc");
  const tDue = modal.querySelector("#tDue");
  const tAttach = modal.querySelector("#tAttach");
  const tSend = modal.querySelector("#tSend");
  const tState = modal.querySelector("#tState");
  const tAttCount = modal.querySelector("#tAttCount");
  const tAttPreview = modal.querySelector("#tAttPreview");

  const tAssigneesWrap = modal.querySelector("#tAssigneesWrap");
  const tAssigneesHint = modal.querySelector("#tAssigneesHint");
  const tAll = modal.querySelector("#tAll");
  const tMe = modal.querySelector("#tMe");
  const tClear = modal.querySelector("#tClear");


  // precarga texto (si quieres: podrías poner aquí textInput.value)
  tDesc.value = textInput.value.trim();

  function renderTaskAttPreview() {
    tAttCount.textContent = attachments.length ? `${attachments.length} adjunto(s)` : "Sin adjuntos";

    if (!attachments.length) {
      tAttPreview.innerHTML = "";
      return;
    }

    // mini preview (2 max + +N)
    const show = attachments.slice(0, 2);
    tAttPreview.innerHTML =
      show.map(a => {
        if (a.isImage) {
          return `<img src="${a.url}" style="width:92px;height:92px;object-fit:cover;border-radius:12px;margin-right:8px;" />`;
        }
        return `<div class="attfile" style="display:inline-flex;margin-right:8px;">📎 <span>${esc(a.name)}</span></div>`;
      }).join("")
      + (attachments.length > 2 ? `<div class="attmore">+${attachments.length - 2} más</div>` : "");
  }

    function renderAssigneesUI() {
    if (!tAssigneesWrap) return;

    // DM: no hace falta selector (backend asigna al peer)
    if (!isGroupChat) {
      tAssigneesWrap.innerHTML = `<div style="padding:10px;border-radius:12px;background:rgba(0,0,0,.06);">
        Responsable: la otra persona (DM)
      </div>`;
      tAssigneesHint.textContent = "";
      selectedAssigneeIds = [];
      return;
    }

    // GROUP: lista de miembros con checkbox
    const myId = String(ME?._id || ME?.id || "");
    const members = Array.isArray(CHAT_MEMBERS) ? CHAT_MEMBERS : [];

    // si no hay selección aún -> por defecto TODOS
    if (!selectedAssigneeIds.length && members.length) {
      selectedAssigneeIds = members.map(m => m.id);
    }

    tAssigneesWrap.innerHTML = `
      <div style="padding:10px;border-radius:12px;background:rgba(0,0,0,.06);">
        ${members.map(m => {
          const checked = selectedAssigneeIds.includes(m.id) ? "checked" : "";
          const label = esc(m.name || m.email || m.id);
          const you = m.id === myId ? " (yo)" : "";
          return `
            <label style="display:flex;align-items:center;gap:10px;margin:6px 0;">
              <input type="checkbox" data-id="${esc(m.id)}" ${checked}/>
              <span>${label}${you}</span>
            </label>
          `;
        }).join("")}
      </div>
    `;

    tAssigneesWrap.querySelectorAll('input[type="checkbox"][data-id]').forEach(cb => {
      cb.addEventListener("change", () => {
        const id = String(cb.getAttribute("data-id") || "");
        if (!id) return;
        if (cb.checked) {
          if (!selectedAssigneeIds.includes(id)) selectedAssigneeIds.push(id);
        } else {
          selectedAssigneeIds = selectedAssigneeIds.filter(x => x !== id);
        }
        updateAssigneesHint();
      });
    });

    updateAssigneesHint();
  }

  function updateAssigneesHint() {
    if (!tAssigneesHint) return;
    if (!isGroupChat) return;

    const members = Array.isArray(CHAT_MEMBERS) ? CHAT_MEMBERS : [];
    const names = members
      .filter(m => selectedAssigneeIds.includes(m.id))
      .map(m => (m.name || m.email || m.id));

    tAssigneesHint.textContent = names.length
      ? `Seleccionados: ${names.join(", ")}`
      : "Nadie seleccionado (si envías así, el backend pondrá TODOS por defecto si no mandas nada)";
  }

  tAll?.addEventListener("click", () => {
    selectedAssigneeIds = (CHAT_MEMBERS || []).map(m => m.id);
    renderAssigneesUI();
  });

  tMe?.addEventListener("click", () => {
    const myId = String(ME?._id || ME?.id || "");
    if (!myId) return;
    selectedAssigneeIds = [myId];
    renderAssigneesUI();
  });

  tClear?.addEventListener("click", () => {
    selectedAssigneeIds = [];
    renderAssigneesUI();
  });

  // pintar UI al abrir modal
  renderAssigneesUI();

  renderTaskAttPreview();

  // adjuntar usa el MISMO fileInput del chat
  tAttach.addEventListener("click", () => fileInput.click());

  // ✅ Si el usuario añade/quita adjuntos mientras el modal está abierto, refresca preview
  obs = new MutationObserver(() => renderTaskAttPreview());
  obs.observe(attachBar, { childList: true, subtree: true });

  // enviar
  tSend.addEventListener("click", async () => {
    if (sendingTask) return;

    const title = tDesc.value.trim();
    if (!title) {
      tState.textContent = "Pon una descripción.";
      return;
    }

    sendingTask = true;
    tState.textContent = "Enviando…";
    tSend.disabled = true;
    tAttach.disabled = true;

    try {
      // dedupe archivos
      const uniq = new Map();
      for (const a of attachments) uniq.set(fileKey(a.file), a.file);
      const files = Array.from(uniq.values());

      const dueISO = tDue.value ? new Date(tDue.value).toISOString() : null;

      await sendTask({
  title,
  dueDate: dueISO,
  files,
  assigneeIds: isGroupChat ? selectedAssigneeIds : null,
});
      textInput.value = "";
      textInput.style.height = "auto";

      // limpia adjuntos (como Flutter pop)
      attachments.forEach(a => { try { URL.revokeObjectURL(a.url); } catch (_) {} });
      attachments = [];
      renderAttachBar();
      updatePlaceholder();

      await load({ silent: true });
      close();
    } catch (e) {
      tState.textContent = e.message || String(e);
    } finally {
      sendingTask = false;
      tSend.disabled = false;
      tAttach.disabled = false;
    }
  });
}

textInput.addEventListener("input", () => {
  textInput.style.height = "auto";
  textInput.style.height = Math.min(textInput.scrollHeight, 140) + "px";
});

  // send
  async function doSend() {
    const text = textInput.value.trim();
    if (sending) return;
    if (!text && !attachments.length) return;

    sending = true;
    sendBtn.disabled = true;

    try {
      // 1) sin adjuntos -> optimista
      if (!attachments.length) {
        const optimistic = {
          _id: "local-" + Date.now(),
          chatId,
          type: "NORMAL",
          text,
          senderName: "Yo",
          senderId: (ME._id || ME.id || null),
          createdAt: new Date().toISOString(),
          attachments: [],
          taskAttachments: [],
        };

        textInput.value = "";
        textInput.style.height = "auto";
        // render optimista
        const current = Array.from(elList.querySelectorAll(".bubble")).length;
        elList.appendChild(renderMessage(optimistic));
        if (current >= 0) scrollToBottom({ smooth: true });

        await sendText(text);
        await load({ silent: true });
        return;
      }

      // 2) con adjuntos -> multipart
      const uniq = new Map();
for (const a of attachments) uniq.set(fileKey(a.file), a.file);
const files = Array.from(uniq.values());

      // limpia UI antes
      textInput.value = "";
      textInput.style.height = "auto";
      attachments.forEach(a => { try { URL.revokeObjectURL(a.url); } catch(_){} });
      attachments = [];
      renderAttachBar();
      updatePlaceholder();

      await sendFiles({ text: text || "", files });
      await load({ silent: true });
    } catch (e) {
      alert("Error enviando: " + (e.message || String(e)));
    } finally {
      sending = false;
      sendBtn.disabled = false;
    }
  }

  sendBtn.addEventListener("click", doSend);
  textInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  });

  // ---- start
  await load({ silent: false });
  polling = setInterval(() => load({ silent: true }), 2500);
});
