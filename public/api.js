// public/api.js
const API_BASE = ""; // mismo dominio

function setToken(t){ localStorage.setItem("done_token", t); }
function getToken(){ return localStorage.getItem("done_token"); }
function clearToken(){ localStorage.removeItem("done_token"); }

/**
 * Core fetch helper:
 * - Mete Authorization: Bearer <token> si existe
 * - Mete Content-Type: application/json cuando hay body (salvo si ya viene)
 * - Lanza Error con mensaje decente
 */
async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  const token = getToken();

  if (token) headers["Authorization"] = `Bearer ${token}`;

  // Si body existe y no es FormData, ponemos JSON por defecto
  const hasBody = opts.body !== undefined && opts.body !== null;
  const isFormData = (typeof FormData !== "undefined") && (opts.body instanceof FormData);

  if (hasBody && !isFormData && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(API_BASE + path, {
  ...opts,
  headers,
  cache: "no-store", // ✅ clave para que NO te responda 304
  });

  console.log("FETCH", path, res.status);


  // intenta parsear JSON siempre
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    // mensaje lo más humano posible
    const msg =
      data?.error ||
      data?.message ||
      `Request failed (${res.status})`;
    throw new Error(msg);
  }

  return data;
}

// =======================
// AUTH
// =======================
async function login(email, password) {
  const data = await api("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  if (data?.token) setToken(data.token);
  return data.user ?? data;
}

async function register(name, email, password) {
  const data = await api("/auth/register", {
    method: "POST",
    body: JSON.stringify({ name, email, password }),
  });
  if (data?.token) setToken(data.token);
  return data.user ?? data;
}

async function me(){
  return api("/me"); // normalmente { user: ... }
}

// =======================
// CHATS (⚠️ SIN /api)
// =======================
// Ajustado para que NO dé 404 en tu backend actual
async function getChats() {
  return api("/chats"); // GET
}

// búsqueda de usuarios (si tu ruta es otra, cambia aquí)
async function searchUsers(q){
  return api(`/users/search?q=${encodeURIComponent(q)}`); // GET
}

async function createDm(otherUserId){
  // Flutter: POST /chats { type:"DM", memberIds:[otherUserId] }
  return api(`/chats`, {
    method: "POST",
    body: JSON.stringify({
      type: "DM",
      memberIds: [otherUserId],
    }),
  });
}

async function createGroup(title, memberIds){
  // Flutter: POST /chats { type:"GROUP", title, memberIds }
  return api(`/chats`, {
    method: "POST",
    body: JSON.stringify({
      type: "GROUP",
      title,
      memberIds,
    }),
  });
}

async function getTaskComments(taskId, limit = 50){
  return api(`/tasks/${encodeURIComponent(taskId)}/comments?limit=${encodeURIComponent(limit)}`);
}

// =======================
// TASKS
// =======================
async function getTask(taskId){
  return api(`/tasks/${encodeURIComponent(taskId)}`); 
  // puede devolver { task: ... } o directamente el task
}


// multipart igual que Flutter: text + files[]
async function postTaskComment({ taskId, text = "", files = [] }){
  const token = getToken();
  const form = new FormData();
  if (text) form.append("text", text);
  for (const f of files) form.append("files", f);

  const res = await fetch(`/tasks/${encodeURIComponent(taskId)}/comments`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });

  const data = await res.json().catch(()=> ({}));
  if(!res.ok){
    const msg = data?.error || data?.message || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

// =======================
// DASHBOARD (⚠️ SIN /api)
// =======================
async function getDashboard(tab = "TAREAS"){
  return api(`/dashboard?tab=${encodeURIComponent(tab)}`);
}

// =======================
// PROFILE (⚠️ SIN /api)
// =======================
async function updateMe(payload){
  return api("/me", {
    method:"PATCH",
    body: JSON.stringify(payload),
  });
}

// avatar multipart (⚠️ SIN /api)
// requiere endpoint tipo POST /me/avatar
// ✅ Subir foto EXACTAMENTE igual que Flutter: POST /me/photo con field "photo"
async function uploadMePhoto(file){
  const token = getToken();
  const form = new FormData();
  form.append("photo", file); // 👈 CLAVE (Flutter manda "photo")

  const res = await fetch("/me/photo", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });

  const data = await res.json().catch(()=> ({}));
  if(!res.ok){
    const msg = data?.error || data?.message || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

async function getTask(taskId){
  return api(`/tasks/${encodeURIComponent(taskId)}`);
}

async function deleteChat(chatId){
  return api(`/chats/${encodeURIComponent(chatId)}`, { method: "DELETE" });
}

async function createGroupWithPhoto(title, memberIds, photo){
  const token = getToken();
  const form = new FormData();
  form.append("type","GROUP");
  form.append("title", String(title || ""));
  form.append("memberIds", JSON.stringify(memberIds || []));
  if(photo) form.append("photo", photo);

  const res = await fetch("/chats", {
    method:"POST",
    headers: token ? { Authorization:`Bearer ${token}` } : {},
    body: form
  });

  const data = await res.json().catch(()=> ({}));
  if(!res.ok) throw new Error(data?.error || data?.message || `Request failed (${res.status})`);
  return data;
}

async function addGroupMembers(chatId, memberIds){
  return api(`/chats/${encodeURIComponent(chatId)}/members`, {
    method:"PATCH",
    body: JSON.stringify({ memberIds }),
  });
}

async function leaveGroup(chatId){
  return api(`/chats/${encodeURIComponent(chatId)}/leave`, {
    method:"POST",
    body: JSON.stringify({}),
  });
}

async function getDashboard(tab = "TAREAS") {
  return api(`/dashboard?tab=${encodeURIComponent(tab)}`);
}

async function saveTaskOrder(section, ids) {
  return api(`/me/task-order`, {
    method: "PATCH",
    body: JSON.stringify({ section, ids }),
  });
}

async function updateTask(taskId, patch) {
  return api(`/tasks/${encodeURIComponent(taskId)}`, {
    method: "PATCH",
    body: JSON.stringify(patch || {}),
  });
}

async function updateTaskAssignees(taskId, body) {
  // body: { add?:[id], remove?:[id], set?:[id] }
  return api(`/tasks/${encodeURIComponent(taskId)}/assignees`, {
    method: "PATCH",
    body: JSON.stringify(body || {}),
  });
}

async function deleteTask(taskId) {
  return api(`/tasks/${encodeURIComponent(taskId)}`, {
    method: "DELETE",
  });
}

// ---- SUBTASKS
async function getSubtasks(taskId) {
  return api(`/tasks/${encodeURIComponent(taskId)}/subtasks`);
}

async function createSubtask(taskId, text) {
  return api(`/tasks/${encodeURIComponent(taskId)}/subtasks`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

async function toggleSubtask(taskId, subtaskId) {
  return api(`/tasks/${encodeURIComponent(taskId)}/subtasks/${encodeURIComponent(subtaskId)}/toggle`, {
    method: "PATCH",
    body: JSON.stringify({}),
  });
}

async function deleteSubtask(taskId, subtaskId) {
  return api(`/tasks/${encodeURIComponent(taskId)}/subtasks/${encodeURIComponent(subtaskId)}`, {
    method: "DELETE",
  });
}


// =======================
// EXPORT GLOBAL
// =======================
window.DONE_API = {
  // token
  setToken, getToken, clearToken,

  // core
  api,

  // auth
  login, register, me,

  // chats
  getChats, searchUsers, createDm, createGroup,

  // dashboard
  getDashboard,

  // profile
  updateMe, uploadMePhoto,

  //Comentarios tareas
  getTaskComments,
  postTaskComment,

  getTask,

  deleteChat,

  createGroup,
  createGroupWithPhoto,

  addGroupMembers,
  leaveGroup,
  getDashboard,
  saveTaskOrder,
  updateTask,
  deleteTask,
  getSubtasks,
  createSubtask,
  toggleSubtask,
  updateTaskAssignees,
  deleteSubtask,
};
