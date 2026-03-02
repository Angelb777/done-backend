// routes/tasks.js (o routes/tasks.router.js)  ✅ COMPLETO
const express = require("express");
const { auth } = require("../middleware/auth");
const Task = require("../models/Task");
const Chat = require("../models/Chat");
const TaskComment = require("../models/TaskComment");
const TaskSubtask = require("../models/TaskSubtask");
const User = require("../models/User");
const { TASK_STATUS, TASK_COLORS } = require("../utils/constants");
const { upload, toPublicUrl } = require("../utils/upload");

const router = express.Router();

// ----------------------------------------------------
// Helpers perms / membership
// ----------------------------------------------------
async function assertMemberByChatId(chatId, userId) {
  const chat = await Chat.findById(chatId).select("_id members");
  if (!chat) return { ok: false, code: 404, error: "Chat not found" };

  const isMember = (chat.members || []).map(String).includes(String(userId));
  if (!isMember) return { ok: false, code: 403, error: "Forbidden" };

  return { ok: true, chat };
}

async function assertMember(task, userId) {
  return assertMemberByChatId(task.chat, userId);
}

function canEdit(task, userId) {
  const me = String(userId);
  const assignees = (task.assignees || []).map(String);
  return assignees.includes(me) || String(task.assignee) === me || String(task.creator) === me;
}

async function assertUsersAreChatMembers(chatId, userIds) {
  const chat = await Chat.findById(chatId).select("_id members");
  if (!chat) return { ok: false, code: 404, error: "Chat not found" };

  const members = new Set((chat.members || []).map(String));
  const bad = (userIds || []).map(String).filter((id) => !members.has(String(id)));

  if (bad.length > 0) {
    return { ok: false, code: 400, error: "Some users are not chat members", badUserIds: bad };
  }

  return { ok: true };
}

// ✅ Admin: por role en DB o por ADMIN_EMAILS del .env (como tu /me)
async function isAdmin(req) {
  try {
    const userId = String(req.user?.id || "");
    if (!userId) return false;

    const u = await User.findById(userId).select("email role");
    if (!u) return false;

    if (String(u.role || "").toLowerCase() === "admin") return true;

    const adminList = (process.env.ADMIN_EMAILS || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    return adminList.includes(String(u.email || "").toLowerCase());
  } catch (_) {
    return false;
  }
}

// ✅ Solo se puede borrar si está en “Historial”
function isHistoryTask(task) {
  // Historial = DONE + (archivedAt != null OR completedAt < now-24h)
  if (!task) return false;
  if (String(task.status) !== TASK_STATUS.DONE) return false;

  const now = Date.now();
  const since = now - 24 * 60 * 60 * 1000;

  const archived = task.archivedAt != null;
  const completedAtMs = task.completedAt ? new Date(task.completedAt).getTime() : null;
  const oldDone = completedAtMs != null && completedAtMs < since;

  return archived || oldDone;
}

// ----------------------------------------------------
// ✅ Helpers subtasks (DTO + orden por parent)
// ----------------------------------------------------
function toSubtaskDTO(s) {
  const isFolder = String(s.type || "ITEM") === "FOLDER";

  // ✅ Para Flutter: si es carpeta, el “texto” que pinta es el title
  const folderTitle = (s.title || "").toString().trim();
  const text = isFolder ? (folderTitle || "Carpeta") : (s.text || "");

  return {
    id: String(s._id),
    _id: String(s._id),
    taskId: String(s.task),
    chatId: String(s.chat),

    type: s.type || "ITEM",
    parentId: s.parentId ? String(s.parentId) : null,
    title: folderTitle,
    collapsed: !!s.collapsed,

    text,
    done: !!s.done,
    doneAt: s.doneAt || null,
    createdAt: s.createdAt,

    color: s.color || "gray",
    order: typeof s.order === "number" ? s.order : 0,

    attachments: (s.attachments || []).map((a) => ({
      url: a.url,
      name: a.name,
      mime: a.mime,
      size: a.size,
    })),
  };
}

async function getNextOrder(taskId, parentId) {
  const q = { task: taskId, parentId: parentId ? parentId : null };
  const last = await TaskSubtask.find(q).sort({ order: -1, createdAt: -1 }).limit(1).select("order");
  const nextOrder = last.length ? Number(last[0].order || 0) + 1 : 1;
  return nextOrder;
}

async function assertFolderBelongs(taskId, folderId) {
  if (!folderId) return { ok: true, folder: null };
  const f = await TaskSubtask.findOne({ _id: folderId, task: taskId }).select("_id type");
  if (!f) return { ok: false, code: 404, error: "Folder not found" };
  if (String(f.type) !== "FOLDER") return { ok: false, code: 400, error: "parentId is not a folder" };
  return { ok: true, folder: f };
}

function orderSubtasksForClient(subtasks) {
  // subtasks: docs ya traídos de Mongo
  // Queremos: root en orden, y cada folder seguido de sus hijos (también en orden)
  const byParent = new Map(); // parentId(string|null) => array
  const keyOf = (p) => (p ? String(p) : "__root__");

  for (const s of subtasks) {
    const k = keyOf(s.parentId);
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k).push(s);
  }

  const sortArr = (arr) =>
    arr.sort((a, b) => {
      const oa = typeof a.order === "number" ? a.order : 0;
      const ob = typeof b.order === "number" ? b.order : 0;
      if (oa !== ob) return oa - ob;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

  for (const [k, arr] of byParent.entries()) sortArr(arr);

  const out = [];
  const root = byParent.get("__root__") || [];

  for (const node of root) {
    out.push(node);

    const isFolder = String(node.type) === "FOLDER";
    if (isFolder) {
      const kids = byParent.get(String(node._id)) || [];
      for (const child of kids) out.push(child);
    }
  }

  return out;
}

async function normalizeFolders(taskId) {
  // Regla:
  // - folder con 0 hijos => se borra
  // - folder con 1 hijo => se “desagrupa” (hijo sube al parent del folder) y folder se borra
  const folders = await TaskSubtask.find({ task: taskId, type: "FOLDER" })
    .select("_id parentId order")
    .sort({ parentId: 1, order: 1, createdAt: 1 });

  for (const f of folders) {
    const children = await TaskSubtask.find({ task: taskId, parentId: f._id })
      .select("_id")
      .sort({ order: 1, createdAt: 1 })
      .limit(2);

    if (children.length === 0) {
      await TaskSubtask.deleteOne({ _id: f._id, task: taskId });
      continue;
    }

    if (children.length === 1) {
      const onlyChildId = children[0]._id;

      const targetParent = f.parentId ? String(f.parentId) : null;
      const baseOrder = await getNextOrder(taskId, targetParent);

      await TaskSubtask.updateOne(
        { _id: onlyChildId, task: taskId },
        { $set: { parentId: targetParent ? targetParent : null, order: baseOrder } }
      );

      await TaskSubtask.deleteOne({ _id: f._id, task: taskId });
    }
  }
}

/**
 * PATCH/POST /tasks/:taskId/toggle
 * - PENDING => DONE (completedAt=now, archivedAt=null)
 * - DONE => PENDING (completedAt=null, archivedAt=null)
 */
async function toggleHandler(req, res, next) {
  try {
    const userId = String(req.user.id);
    const { taskId } = req.params;

    const task = await Task.findById(taskId).select(
      "_id chat status assignee assignees creator completedAt archivedAt"
    );
    if (!task) return res.status(404).json({ error: "Task not found" });

    if (!canEdit(task, userId)) return res.status(403).json({ error: "Forbidden" });

    const mem = await assertMember(task, userId);
    if (!mem.ok) return res.status(mem.code).json({ error: mem.error });

    const now = new Date();

    if (task.status === TASK_STATUS.PENDING) {
      task.status = TASK_STATUS.DONE;
      task.completedAt = now;
      task.archivedAt = null; // ✅ se queda 24h en "Tareas"
    } else {
      task.status = TASK_STATUS.PENDING;
      task.completedAt = null;
      task.archivedAt = null;
    }

    await task.save();

    return res.json({
      task: {
        id: task._id,
        status: task.status,
        completedAt: task.completedAt || null,
        archivedAt: task.archivedAt || null,
      },
    });
  } catch (err) {
    next(err);
  }
}

router.patch("/:taskId/toggle", auth, toggleHandler);
router.post("/:taskId/toggle", auth, toggleHandler);

/**
 * PATCH/POST /tasks/:taskId/archive
 * - Solo si está DONE
 * - archivedAt = now
 */
async function archiveHandler(req, res, next) {
  try {
    const userId = String(req.user.id);
    const { taskId } = req.params;

    const task = await Task.findById(taskId).select(
      "_id chat status assignee assignees creator archivedAt completedAt"
    );
    if (!task) return res.status(404).json({ error: "Task not found" });

    if (!canEdit(task, userId)) return res.status(403).json({ error: "Forbidden" });

    const mem = await assertMember(task, userId);
    if (!mem.ok) return res.status(mem.code).json({ error: mem.error });

    if (task.status !== TASK_STATUS.DONE) {
      return res.status(400).json({ error: "Only DONE tasks can be archived" });
    }

    task.archivedAt = new Date();
    await task.save();

    return res.json({
      task: { id: task._id, archivedAt: task.archivedAt },
    });
  } catch (err) {
    next(err);
  }
}

router.patch("/:taskId/archive", auth, archiveHandler);
router.post("/:taskId/archive", auth, archiveHandler);

// ----------------------------------------------------
// ✅ DELETE /tasks/:taskId  (BORRAR, solo Historial)
// Reglas:
// - Debe ser miembro del chat
// - Debe estar en historial (archivedAt o DONE viejo)
// - Permisos: creator o admin
// - Borra también comments + subtasks
// ----------------------------------------------------
router.delete("/:taskId", auth, async (req, res, next) => {
  try {
    const userId = String(req.user.id);
    const { taskId } = req.params;

    const task = await Task.findById(taskId).select("_id chat status creator completedAt archivedAt");
    if (!task) return res.status(404).json({ error: "Task not found" });

    const mem = await assertMember(task, userId);
    if (!mem.ok) return res.status(mem.code).json({ error: mem.error });

    if (!isHistoryTask(task)) {
      return res.status(400).json({ error: "Only history tasks can be deleted" });
    }

    const isCreator = String(task.creator) === userId;
    const admin = await isAdmin(req);

    if (!isCreator && !admin) {
      return res.status(403).json({ error: "Forbidden" });
    }

    await TaskComment.deleteMany({ task: taskId });
    await TaskSubtask.deleteMany({ task: taskId });
    await Task.deleteOne({ _id: taskId });

    return res.json({ ok: true, deletedTaskId: String(taskId) });
  } catch (err) {
    next(err);
  }
});

// ----------------------------------------------------
// ✅ SUBTASKS
// GET  /tasks/:taskId/subtasks
// POST /tasks/:taskId/subtasks { text, parentId? }        (ITEM)
// PATCH /tasks/:taskId/subtasks/:subtaskId/toggle
// DELETE /tasks/:taskId/subtasks/:subtaskId
//
// ✅ NUEVAS:
// POST  /tasks/:taskId/subtasks/folder { title, parentId? }          (FOLDER)
// PATCH /tasks/:taskId/subtasks/:folderId/folder { title?, collapsed? }
// PATCH /tasks/:taskId/subtasks/move { ids:[...], parentId:null|folderId }  (mover items/folders)
// POST  /tasks/:taskId/subtasks/group { title, ids:[...], parentId? }       (crear carpeta + meter items)
// POST  /tasks/:taskId/subtasks/:folderId/ungroup                          (sacar hijos a root + borrar folder)
// ----------------------------------------------------

router.get("/:taskId/subtasks", auth, async (req, res, next) => {
  try {
    const userId = String(req.user.id);
    const { taskId } = req.params;

    const task = await Task.findById(taskId).select("_id chat");
    if (!task) return res.status(404).json({ error: "Task not found" });

    const mem = await assertMember(task, userId);
    if (!mem.ok) return res.status(mem.code).json({ error: mem.error });

    // ✅ orden por parentId + order (y fallback createdAt)
    const subtasks = await TaskSubtask.find({ task: taskId }).sort({
  order: 1,
  createdAt: 1,
});

// ✅ devuelve en orden “folder + hijos”
const ordered = orderSubtasksForClient(subtasks);

return res.json({ subtasks: ordered.map(toSubtaskDTO) });
  } catch (e) {
    next(e);
  }
});

router.post("/:taskId/subtasks", auth, async (req, res, next) => {
  try {
    const userId = String(req.user.id);
    const { taskId } = req.params;

    const text = String(req.body.text || "").trim();
    if (!text) return res.status(400).json({ error: "text required" });

    const parentIdRaw = req.body.parentId;
    const parentId = parentIdRaw ? String(parentIdRaw).trim() : null;

    const task = await Task.findById(taskId).select("_id chat assignee assignees creator");
    if (!task) return res.status(404).json({ error: "Task not found" });

    const mem = await assertMember(task, userId);
    if (!mem.ok) return res.status(mem.code).json({ error: mem.error });

    if (!canEdit(task, userId)) return res.status(403).json({ error: "Forbidden" });

    // si parentId viene, debe ser folder de esta task
    if (parentId) {
      const chk = await assertFolderBelongs(taskId, parentId);
      if (!chk.ok) return res.status(chk.code).json({ error: chk.error });
    }

    const nextOrder = await getNextOrder(taskId, parentId);

    const sub = await TaskSubtask.create({
      task: taskId,
      chat: task.chat,
      creator: userId,

      type: "ITEM",
      parentId: parentId || null,

      text,
      done: false,
      doneAt: null,
      color: "gray",
      order: nextOrder,
      attachments: [],

      title: "",
      collapsed: false,
    });

    await normalizeFolders(taskId);

    return res.json({ subtask: toSubtaskDTO(sub) });
  } catch (e) {
    next(e);
  }
});

// ✅ Crear carpeta (FOLDER)
router.post("/:taskId/subtasks/folder", auth, async (req, res, next) => {
  try {
    const userId = String(req.user.id);
    const { taskId } = req.params;

    const title = String(req.body.title || "").trim();
    if (!title) return res.status(400).json({ error: "title required" });

    const parentIdRaw = req.body.parentId;
    const parentId = parentIdRaw ? String(parentIdRaw).trim() : null;

    const task = await Task.findById(taskId).select("_id chat assignee assignees creator");
    if (!task) return res.status(404).json({ error: "Task not found" });

    const mem = await assertMember(task, userId);
    if (!mem.ok) return res.status(mem.code).json({ error: mem.error });

    if (!canEdit(task, userId)) return res.status(403).json({ error: "Forbidden" });

    if (parentId) {
      const chk = await assertFolderBelongs(taskId, parentId);
      if (!chk.ok) return res.status(chk.code).json({ error: chk.error });
    }

    const nextOrder = await getNextOrder(taskId, parentId);

    const folder = await TaskSubtask.create({
      task: taskId,
      chat: task.chat,
      creator: userId,

      type: "FOLDER",
      parentId: parentId || null,

      // mantenemos compatibilidad: text required
      text: "__FOLDER__",

      done: false,
      doneAt: null,
      color: "gray",
      order: nextOrder,
      attachments: [],

      title,
      collapsed: false,
    });

    return res.json({ folder: toSubtaskDTO(folder) });
  } catch (e) {
    next(e);
  }
});

// ✅ Renombrar / colapsar carpeta
router.patch("/:taskId/subtasks/:folderId/folder", auth, async (req, res, next) => {
  try {
    const userId = String(req.user.id);
    const { taskId, folderId } = req.params;

    const task = await Task.findById(taskId).select("_id chat assignee assignees creator");
    if (!task) return res.status(404).json({ error: "Task not found" });

    const mem = await assertMember(task, userId);
    if (!mem.ok) return res.status(mem.code).json({ error: mem.error });

    if (!canEdit(task, userId)) return res.status(403).json({ error: "Forbidden" });

    const folder = await TaskSubtask.findOne({ _id: folderId, task: taskId });
    if (!folder) return res.status(404).json({ error: "Folder not found" });
    if (String(folder.type) !== "FOLDER") return res.status(400).json({ error: "Not a folder" });

    if ("title" in req.body) {
      const title = String(req.body.title || "").trim();
      if (!title) return res.status(400).json({ error: "title required" });
      folder.title = title;
    }

    if ("collapsed" in req.body) {
      folder.collapsed = req.body.collapsed === true;
    }

    await folder.save();

    return res.json({ ok: true, folder: toSubtaskDTO(folder) });
  } catch (e) {
    next(e);
  }
});

// ✅ Mover (items o folders) a root o a una carpeta
router.patch("/:taskId/subtasks/move", auth, async (req, res, next) => {
  try {
    const userId = String(req.user.id);
    const { taskId } = req.params;

    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(String) : [];
    if (!ids.length) return res.status(400).json({ error: "ids required" });

    const parentIdRaw = req.body.parentId;
    const parentId = parentIdRaw ? String(parentIdRaw).trim() : null;

    const task = await Task.findById(taskId).select("_id chat assignee assignees creator");
    if (!task) return res.status(404).json({ error: "Task not found" });

    const mem = await assertMember(task, userId);
    if (!mem.ok) return res.status(mem.code).json({ error: mem.error });

    if (!canEdit(task, userId)) return res.status(403).json({ error: "Forbidden" });

    if (parentId) {
      const chk = await assertFolderBelongs(taskId, parentId);
      if (!chk.ok) return res.status(chk.code).json({ error: chk.error });
    }

    // valida que todos son de esta task
    const subs = await TaskSubtask.find({ task: taskId, _id: { $in: ids } }).select("_id type");
    if (subs.length !== ids.length) {
      return res.status(400).json({ error: "Some items do not belong to this task" });
    }

    // evita meter una carpeta dentro de sí misma
    if (parentId && ids.includes(String(parentId))) {
      return res.status(400).json({ error: "Folder cannot be moved into itself" });
    }

    // mover y reordenar al final del parent destino
    let baseOrder = await getNextOrder(taskId, parentId);
    const ops = ids.map((id, idx) => ({
      updateOne: {
        filter: { _id: id, task: taskId },
        update: { $set: { parentId: parentId || null, order: baseOrder + idx } },
      },
    }));

    await TaskSubtask.bulkWrite(ops, { ordered: true });

    await normalizeFolders(taskId);

    return res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// ✅ Agrupar items en carpeta (crea folder y mete ids dentro)
router.post("/:taskId/subtasks/group", auth, async (req, res, next) => {
  try {
    const userId = String(req.user.id);
    const { taskId } = req.params;

    const title = String(req.body.title || "").trim();
    if (!title) return res.status(400).json({ error: "title required" });

    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(String) : [];
    if (!ids.length) return res.status(400).json({ error: "ids required" });

    const parentIdRaw = req.body.parentId;
    const parentId = parentIdRaw ? String(parentIdRaw).trim() : null;

    const task = await Task.findById(taskId).select("_id chat assignee assignees creator");
    if (!task) return res.status(404).json({ error: "Task not found" });

    const mem = await assertMember(task, userId);
    if (!mem.ok) return res.status(mem.code).json({ error: mem.error });

    if (!canEdit(task, userId)) return res.status(403).json({ error: "Forbidden" });

    if (parentId) {
      const chk = await assertFolderBelongs(taskId, parentId);
      if (!chk.ok) return res.status(chk.code).json({ error: chk.error });
    }

    // valida ids pertenecen a esta task y son ITEM (no carpetas)
    const subs = await TaskSubtask.find({ task: taskId, _id: { $in: ids } }).select("_id type");
    if (subs.length !== ids.length) return res.status(400).json({ error: "Some items do not belong to this task" });

    const hasFolderInside = subs.some((s) => String(s.type) === "FOLDER");
    if (hasFolderInside) return res.status(400).json({ error: "Cannot group folders (only items)" });

    // crea folder en parentId
    const folderOrder = await getNextOrder(taskId, parentId);

    const folder = await TaskSubtask.create({
      task: taskId,
      chat: task.chat,
      creator: userId,
      type: "FOLDER",
      parentId: parentId || null,
      text: "__FOLDER__",
      done: false,
      doneAt: null,
      color: "gray",
      order: folderOrder,
      attachments: [],
      title,
      collapsed: false,
    });

    // mueve los items a ese folder y reordena desde 1
    const moveOps = ids.map((id, idx) => ({
      updateOne: {
        filter: { _id: id, task: taskId },
        update: { $set: { parentId: folder._id, order: idx + 1 } },
      },
    }));

    await TaskSubtask.bulkWrite(moveOps, { ordered: true });

    await normalizeFolders(taskId);

    return res.json({ ok: true, folder: toSubtaskDTO(folder) });
  } catch (e) {
    next(e);
  }
});

// ✅ Desagrupar: saca hijos a root y borra folder
router.post("/:taskId/subtasks/:folderId/ungroup", auth, async (req, res, next) => {
  try {
    const userId = String(req.user.id);
    const { taskId, folderId } = req.params;

    const task = await Task.findById(taskId).select("_id chat assignee assignees creator");
    if (!task) return res.status(404).json({ error: "Task not found" });

    const mem = await assertMember(task, userId);
    if (!mem.ok) return res.status(mem.code).json({ error: mem.error });

    if (!canEdit(task, userId)) return res.status(403).json({ error: "Forbidden" });

    const folder = await TaskSubtask.findOne({ _id: folderId, task: taskId });
    if (!folder) return res.status(404).json({ error: "Folder not found" });
    if (String(folder.type) !== "FOLDER") return res.status(400).json({ error: "Not a folder" });

    // hijos
    const children = await TaskSubtask.find({ task: taskId, parentId: folder._id }).sort({ order: 1, createdAt: 1 }).select("_id");

    // mover hijos al parent del folder (o root)
    const targetParent = folder.parentId ? String(folder.parentId) : null;
    const baseOrder = await getNextOrder(taskId, targetParent);

    const ops = children.map((c, idx) => ({
      updateOne: {
        filter: { _id: c._id, task: taskId },
        update: { $set: { parentId: targetParent ? targetParent : null, order: baseOrder + idx } },
      },
    }));

    if (ops.length) await TaskSubtask.bulkWrite(ops, { ordered: true });

    // borrar folder
    await TaskSubtask.deleteOne({ _id: folderId, task: taskId });

    await normalizeFolders(taskId);

    return res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.patch("/:taskId/subtasks/:subtaskId/toggle", auth, async (req, res, next) => {
  try {
    const userId = String(req.user.id);
    const { taskId, subtaskId } = req.params;

    const task = await Task.findById(taskId).select("_id chat assignee assignees creator");
    if (!task) return res.status(404).json({ error: "Task not found" });

    const mem = await assertMember(task, userId);
    if (!mem.ok) return res.status(mem.code).json({ error: mem.error });

    if (!canEdit(task, userId)) return res.status(403).json({ error: "Forbidden" });

    const sub = await TaskSubtask.findOne({ _id: subtaskId, task: taskId });
    if (!sub) return res.status(404).json({ error: "Subtask not found" });

    // ✅ no tiene sentido toggle en carpeta
    if (String(sub.type) === "FOLDER") {
      return res.status(400).json({ error: "Folders cannot be toggled" });
    }

    sub.done = !sub.done;
    sub.doneAt = sub.done ? new Date() : null;
    await sub.save();

    return res.json({ subtask: toSubtaskDTO(sub) });
  } catch (e) {
    next(e);
  }
});

router.delete("/:taskId/subtasks/:subtaskId", auth, async (req, res, next) => {
  try {
    const userId = String(req.user.id);
    const { taskId, subtaskId } = req.params;

    const task = await Task.findById(taskId).select("_id chat assignee assignees creator");
    if (!task) return res.status(404).json({ error: "Task not found" });

    const mem = await assertMember(task, userId);
    if (!mem.ok) return res.status(mem.code).json({ error: mem.error });

    if (!canEdit(task, userId)) return res.status(403).json({ error: "Forbidden" });

    const sub = await TaskSubtask.findOne({ _id: subtaskId, task: taskId }).select("_id type");
    if (!sub) return res.status(404).json({ error: "Subtask not found" });

    if (String(sub.type) === "FOLDER") {
      // ✅ si borras carpeta: borra hijos también (simple y consistente)
      await TaskSubtask.deleteMany({ task: taskId, parentId: sub._id });
      await TaskSubtask.deleteOne({ _id: subtaskId, task: taskId });
      await normalizeFolders(taskId);
      return res.json({ ok: true, deletedFolderId: String(subtaskId) });
    }

    const r = await TaskSubtask.deleteOne({ _id: subtaskId, task: taskId });
    if (!r || r.deletedCount !== 1) return res.status(404).json({ error: "Subtask not found" });

    await normalizeFolders(taskId);

    return res.json({ ok: true, deletedSubtaskId: String(subtaskId) });
  } catch (e) {
    next(e);
  }
});

// ----------------------------------------------------
// ✅ COMMENTS
// GET  /tasks/:taskId/comments?limit=30&before=ISO_DATE
// POST /tasks/:taskId/comments  (multipart) fields: text, files[]
// ----------------------------------------------------
router.get("/:taskId/comments", auth, async (req, res, next) => {
  try {
    const userId = String(req.user.id);
    const { taskId } = req.params;

    const limit = Math.min(Number(req.query.limit || 30), 100);
    const before = req.query.before ? new Date(String(req.query.before)) : null;

    const task = await Task.findById(taskId).select("_id chat");
    if (!task) return res.status(404).json({ error: "Task not found" });

    const mem = await assertMember(task, userId);
    if (!mem.ok) return res.status(mem.code).json({ error: mem.error });

    const query = { task: taskId };
    if (before && !Number.isNaN(before.getTime())) query.createdAt = { $lt: before };

    const comments = await TaskComment.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate("sender", "name email photoUrl status");

    return res.json({
      comments: comments.reverse().map((c) => ({
        id: c._id,
        taskId: String(c.task),
        chatId: String(c.chat),
        text: c.text || "",
        attachments: (c.attachments || []).map((a) => ({
          url: a.url,
          name: a.name,
          mime: a.mime,
          size: a.size,
        })),
        sender: c.sender
          ? {
              id: String(c.sender._id),
              name: c.sender.name,
              email: c.sender.email,
              photoUrl: c.sender.photoUrl || null,
              status: c.sender.status || "",
            }
          : { id: null, name: "Unknown", email: "", photoUrl: null, status: "" },
        createdAt: c.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.post("/:taskId/comments", auth, upload.array("files", 10), async (req, res, next) => {
  try {
    const userId = String(req.user.id);
    const { taskId } = req.params;

    const text = String(req.body.text || "").trim();
    const files = req.files || [];

    if (!text && (!Array.isArray(files) || files.length === 0)) {
      return res.status(400).json({ error: "text or files required" });
    }

    const task = await Task.findById(taskId).select("_id chat");
    if (!task) return res.status(404).json({ error: "Task not found" });

    const mem = await assertMember(task, userId);
    if (!mem.ok) return res.status(mem.code).json({ error: mem.error });

    const attachments = (files || []).map((f) => ({
      url: toPublicUrl(req, f.filename),
      name: f.originalname || f.filename,
      mime: f.mimetype || "application/octet-stream",
      size: typeof f.size === "number" ? f.size : 0,
    }));

    const comment = await TaskComment.create({
      task: taskId,
      chat: task.chat,
      sender: userId,
      text: text || "",
      attachments,
    });

    await comment.populate("sender", "name email photoUrl status");

    return res.json({
      comment: {
        id: comment._id,
        taskId: String(comment.task),
        chatId: String(comment.chat),
        text: comment.text || "",
        attachments: (comment.attachments || []).map((a) => ({
          url: a.url,
          name: a.name,
          mime: a.mime,
          size: a.size,
        })),
        sender: comment.sender
          ? {
              id: String(comment.sender._id),
              name: comment.sender.name,
              email: comment.sender.email,
              photoUrl: comment.sender.photoUrl || null,
              status: comment.sender.status || "",
            }
          : { id: null, name: "Unknown", email: "", photoUrl: null, status: "" },
        createdAt: comment.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ----------------------------------------------------
// ✅ ASSIGNEES (responsables) - editar tras crear
// PATCH /tasks/:taskId/assignees
// body: { add?: [userId], remove?: [userId], set?: [userId] }
// ----------------------------------------------------
router.patch("/:taskId/assignees", auth, async (req, res, next) => {
  try {
    const userId = String(req.user.id);
    const taskId = String(req.params.taskId);

    const task = await Task.findById(taskId).select("_id chat creator assignee assignees");
    if (!task) return res.status(404).json({ error: "Task not found" });

    const mem = await assertMember(task, userId);
    if (!mem.ok) return res.status(mem.code).json({ error: mem.error });

    if (!canEdit(task, userId)) return res.status(403).json({ error: "Forbidden" });

    const add = Array.isArray(req.body.add) ? req.body.add.map(String) : [];
    const remove = Array.isArray(req.body.remove) ? req.body.remove.map(String) : [];
    const set = Array.isArray(req.body.set) ? req.body.set.map(String) : null;

    let nextAssignees;
    if (set) {
      nextAssignees = set.map(String);
    } else {
      const cur = new Set((task.assignees || []).map(String));
      for (const id of add) cur.add(String(id));
      for (const id of remove) cur.delete(String(id));
      nextAssignees = [...cur];
    }

    if (!nextAssignees || nextAssignees.length === 0) {
      return res.status(400).json({ error: "Task must have at least 1 assignee" });
    }

    const chk = await assertUsersAreChatMembers(task.chat, nextAssignees);
    if (!chk.ok) return res.status(chk.code).json({ error: chk.error, badUserIds: chk.badUserIds });

    task.assignees = nextAssignees;
    task.assignee = nextAssignees[0];

    await task.save();

    return res.json({
      ok: true,
      task: {
        id: String(task._id),
        assignee: String(task.assignee),
        assignees: (task.assignees || []).map(String),
      },
    });
  } catch (e) {
    next(e);
  }
});

// ✅ GET /tasks/:taskId  -> devuelve la tarea (para abrir modal/pantalla)
router.get("/:taskId", auth, async (req, res, next) => {
  try {
    const userId = String(req.user.id);
    const taskId = String(req.params.taskId);

    const task = await Task.findById(taskId)
      .populate("creator", "name email photoUrl status")
      .populate("assignee", "name email photoUrl status")
      .populate("assignees", "name email photoUrl status")
      .populate("chat", "type title");

    if (!task) return res.status(404).json({ error: "Task not found" });

    const mem = await assertMember(task, userId);
    if (!mem.ok) return res.status(mem.code).json({ error: mem.error });

    return res.json({
      task: {
        id: String(task._id),
        _id: String(task._id),
        title: task.title,
        status: task.status,
        color: task.color,
        dueDate: task.dueDate || null,
        createdAt: task.createdAt,
        completedAt: task.completedAt || null,
        archivedAt: task.archivedAt || null,
        attachments: (task.attachments || []).map((a) => ({
          url: a.url,
          name: a.name,
          mime: a.mime,
          size: a.size,
        })),
        chat: task.chat
          ? { id: String(task.chat._id), _id: String(task.chat._id), type: task.chat.type, title: task.chat.title }
          : null,
        creator: task.creator
          ? { id: String(task.creator._id), _id: String(task.creator._id), name: task.creator.name }
          : null,
        assignee: task.assignee
          ? { id: String(task.assignee._id), _id: String(task.assignee._id), name: task.assignee.name }
          : null,
        assignees: (task.assignees || []).map((u) => ({
          id: String(u._id),
          _id: String(u._id),
          name: u.name,
          email: u.email,
          photoUrl: u.photoUrl || null,
          status: u.status || "",
        })),
      },
    });
  } catch (e) {
    next(e);
  }
});

// ✅ PATCH /tasks/:taskId  (editar dueDate / color)
router.patch("/:taskId", auth, async (req, res, next) => {
  try {
    const userId = String(req.user.id);
    const taskId = String(req.params.taskId);

    const task = await Task.findById(taskId)
      .populate("creator", "name email photoUrl")
      .populate("assignee", "name email photoUrl")
      .populate("chat", "type title");

    if (!task) return res.status(404).json({ error: "Task not found" });

    const isCreator = String(task.creator?._id || task.creator) === userId;
    const isAssignee = String(task.assignee?._id || task.assignee) === userId;
    const isInAssignees = Array.isArray(task.assignees) ? task.assignees.map(String).includes(userId) : false;

    if (!isCreator && !isAssignee && !isInAssignees) {
      return res.status(403).json({ error: "Forbidden" });
    }

    if ("dueDate" in req.body) {
      const dueDate = req.body.dueDate;
      task.dueDate = dueDate ? new Date(dueDate) : null;
    }

    if ("color" in req.body) {
      const c = String(req.body.color || "").trim();
      if (!TASK_COLORS.includes(c)) {
        return res.status(400).json({ error: "Invalid color" });
      }
      task.color = c;
    }

    await task.save();

    return res.json({
      ok: true,
      task: {
        id: String(task._id),
        _id: String(task._id),
        title: task.title,
        status: task.status,
        color: task.color,
        dueDate: task.dueDate,
        createdAt: task.createdAt,
        completedAt: task.completedAt || null,
        archivedAt: task.archivedAt || null,
        attachments: (task.attachments || []).map((a) => ({
          url: a.url,
          name: a.name,
          mime: a.mime,
          size: a.size,
        })),
        chat: task.chat
          ? { _id: String(task.chat._id), id: String(task.chat._id), type: task.chat.type, title: task.chat.title }
          : null,
        creator: task.creator ? { _id: String(task.creator._id), id: String(task.creator._id), name: task.creator.name } : null,
        assignee: task.assignee ? { _id: String(task.assignee._id), id: String(task.assignee._id), name: task.assignee.name } : null,
      },
    });
  } catch (e) {
    next(e);
  }
});

// ✅ Reorder (ahora soporta parentId opcional)
router.patch("/:taskId/subtasks/reorder", auth, async (req, res, next) => {
  try {
    const userId = String(req.user.id);
    const { taskId } = req.params;

    const orderedIds = Array.isArray(req.body.orderedIds) ? req.body.orderedIds.map(String) : [];
    if (!orderedIds.length) return res.status(400).json({ error: "orderedIds required" });

    const parentIdRaw = req.body.parentId;
    const parentId = parentIdRaw ? String(parentIdRaw).trim() : null;

    const task = await Task.findById(taskId).select("_id chat assignee assignees creator");
    if (!task) return res.status(404).json({ error: "Task not found" });

    const mem = await assertMember(task, userId);
    if (!mem.ok) return res.status(mem.code).json({ error: mem.error });

    if (!canEdit(task, userId)) return res.status(403).json({ error: "Forbidden" });

    if (parentId) {
      const chk = await assertFolderBelongs(taskId, parentId);
      if (!chk.ok) return res.status(chk.code).json({ error: chk.error });
    }

    // ✅ Asegura que todos pertenecen a esta task y a ESTE parentId
    const subs = await TaskSubtask.find({
      task: taskId,
      parentId: parentId ? parentId : null,
      _id: { $in: orderedIds },
    }).select("_id");

    if (subs.length !== orderedIds.length) {
      return res.status(400).json({ error: "Some subtasks do not belong to this parent" });
    }

    const ops = orderedIds.map((id, idx) => ({
      updateOne: {
        filter: { _id: id, task: taskId },
        update: { $set: { order: idx + 1 } },
      },
    }));

    await TaskSubtask.bulkWrite(ops, { ordered: true });
    return res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.patch("/:taskId/subtasks/:subtaskId/color", auth, async (req, res, next) => {
  try {
    const userId = String(req.user.id);
    const { taskId, subtaskId } = req.params;

    const color = String(req.body.color || "").trim();
    if (!TASK_COLORS.includes(color)) return res.status(400).json({ error: "Invalid color" });

    const task = await Task.findById(taskId).select("_id chat assignee assignees creator");
    if (!task) return res.status(404).json({ error: "Task not found" });

    const mem = await assertMember(task, userId);
    if (!mem.ok) return res.status(mem.code).json({ error: mem.error });

    if (!canEdit(task, userId)) return res.status(403).json({ error: "Forbidden" });

    const sub = await TaskSubtask.findOne({ _id: subtaskId, task: taskId });
    if (!sub) return res.status(404).json({ error: "Subtask not found" });

    sub.color = color;
    await sub.save();

    return res.json({ ok: true, subtask: { id: String(sub._id), color: sub.color } });
  } catch (e) {
    next(e);
  }
});

router.post(
  "/:taskId/subtasks/:subtaskId/files",
  auth,
  upload.array("files", 10),
  async (req, res, next) => {
    try {
      const userId = String(req.user.id);
      const { taskId, subtaskId } = req.params;

      const files = req.files || [];
      if (!Array.isArray(files) || files.length === 0) {
        return res.status(400).json({ error: "files required" });
      }

      const task = await Task.findById(taskId).select("_id chat assignee assignees creator attachments");
      if (!task) return res.status(404).json({ error: "Task not found" });

      const mem = await assertMember(task, userId);
      if (!mem.ok) return res.status(mem.code).json({ error: mem.error });

      if (!canEdit(task, userId)) return res.status(403).json({ error: "Forbidden" });

      const sub = await TaskSubtask.findOne({ _id: subtaskId, task: taskId });
      if (!sub) return res.status(404).json({ error: "Subtask not found" });

      const newAttachments = files.map((f) => ({
        url: toPublicUrl(req, f.filename),
        name: f.originalname || f.filename,
        mime: f.mimetype || "application/octet-stream",
        size: typeof f.size === "number" ? f.size : 0,
        source: { type: "SUBTASK", subtaskId: String(sub._id) },
      }));

      // 1) Guardar en la subtarea
      sub.attachments = [...(sub.attachments || []), ...newAttachments];
      await sub.save();

      // 2) Copiar también en la tarea
      task.attachments = [
        ...(task.attachments || []),
        ...newAttachments.map((a) => ({
          url: a.url,
          name: a.name,
          mime: a.mime,
          size: a.size,
        })),
      ];
      await task.save();

      return res.json({
        ok: true,
        subtask: {
          id: String(sub._id),
          attachments: (sub.attachments || []).map((a) => ({
            url: a.url,
            name: a.name,
            mime: a.mime,
            size: a.size,
          })),
        },
        task: {
          id: String(task._id),
          attachments: (task.attachments || []).map((a) => ({
            url: a.url,
            name: a.name,
            mime: a.mime,
            size: a.size,
          })),
        },
      });
    } catch (e) {
      next(e);
    }
  }
);

module.exports = router;