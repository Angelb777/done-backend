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
// - Borra también comments
// ----------------------------------------------------
router.delete("/:taskId", auth, async (req, res, next) => {
  try {
    const userId = String(req.user.id);
    const { taskId } = req.params;

    const task = await Task.findById(taskId).select(
      "_id chat status creator completedAt archivedAt"
    );
    if (!task) return res.status(404).json({ error: "Task not found" });

    // miembro del chat
    const mem = await assertMember(task, userId);
    if (!mem.ok) return res.status(mem.code).json({ error: mem.error });

    // solo historial
    if (!isHistoryTask(task)) {
      return res.status(400).json({ error: "Only history tasks can be deleted" });
    }

    // permisos: creator o admin
    const isCreator = String(task.creator) === userId;
    const admin = await isAdmin(req);

    if (!isCreator && !admin) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // borra comments asociados
    await TaskComment.deleteMany({ task: taskId });

    await TaskSubtask.deleteMany({ task: taskId });

    // borra task
    await Task.deleteOne({ _id: taskId });

    return res.json({ ok: true, deletedTaskId: String(taskId) });
  } catch (err) {
    next(err);
  }
});

// ----------------------------------------------------
// ✅ SUBTASKS
// GET  /tasks/:taskId/subtasks
// POST /tasks/:taskId/subtasks { text }
// PATCH /tasks/:taskId/subtasks/:subtaskId/toggle
// DELETE /tasks/:taskId/subtasks/:subtaskId
// ----------------------------------------------------

router.get("/:taskId/subtasks", auth, async (req, res, next) => {
  try {
    const userId = String(req.user.id);
    const { taskId } = req.params;

    const task = await Task.findById(taskId).select("_id chat");
    if (!task) return res.status(404).json({ error: "Task not found" });

    const mem = await assertMember(task, userId);
    if (!mem.ok) return res.status(mem.code).json({ error: mem.error });

    const subtasks = await TaskSubtask.find({ task: taskId }).sort({ createdAt: 1 });

    return res.json({
      subtasks: subtasks.map((s) => ({
        id: String(s._id),
        taskId: String(s.task),
        chatId: String(s.chat),
        text: s.text,
        done: !!s.done,
        doneAt: s.doneAt || null,
        createdAt: s.createdAt,
      })),
    });
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

    const task = await Task.findById(taskId).select("_id chat assignee assignees creator");
    if (!task) return res.status(404).json({ error: "Task not found" });

    const mem = await assertMember(task, userId);
    if (!mem.ok) return res.status(mem.code).json({ error: mem.error });

    // Si quieres: solo quien puede editar la task puede crear subtareas
    if (!canEdit(task, userId)) return res.status(403).json({ error: "Forbidden" });

    const sub = await TaskSubtask.create({
      task: taskId,
      chat: task.chat,
      creator: userId,
      text,
      done: false,
      doneAt: null,
    });

    return res.json({
      subtask: {
        id: String(sub._id),
        taskId: String(sub.task),
        chatId: String(sub.chat),
        text: sub.text,
        done: !!sub.done,
        doneAt: sub.doneAt || null,
        createdAt: sub.createdAt,
      },
    });
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

    sub.done = !sub.done;
    sub.doneAt = sub.done ? new Date() : null;
    await sub.save();

    return res.json({
      subtask: {
        id: String(sub._id),
        taskId: String(sub.task),
        chatId: String(sub.chat),
        text: sub.text,
        done: !!sub.done,
        doneAt: sub.doneAt || null,
        createdAt: sub.createdAt,
      },
    });
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

    const r = await TaskSubtask.deleteOne({ _id: subtaskId, task: taskId });

    if (!r || r.deletedCount !== 1) {
      return res.status(404).json({ error: "Subtask not found" });
    }

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

    const task = await Task.findById(taskId).select(
      "_id chat creator assignee assignees"
    );
    if (!task) return res.status(404).json({ error: "Task not found" });

    // miembro del chat
    const mem = await assertMember(task, userId);
    if (!mem.ok) return res.status(mem.code).json({ error: mem.error });

    // permisos
    if (!canEdit(task, userId)) return res.status(403).json({ error: "Forbidden" });

    const add = Array.isArray(req.body.add) ? req.body.add.map(String) : [];
    const remove = Array.isArray(req.body.remove) ? req.body.remove.map(String) : [];
    const set = Array.isArray(req.body.set) ? req.body.set.map(String) : null;

    // si viene "set", manda
    let nextAssignees;
    if (set) {
      nextAssignees = set.map(String);
    } else {
      const cur = new Set((task.assignees || []).map(String));
      for (const id of add) cur.add(String(id));
      for (const id of remove) cur.delete(String(id));
      nextAssignees = [...cur];
    }

    // ✅ Evita dejar tarea sin responsables (si quieres permitirlo, quita esto)
    if (!nextAssignees || nextAssignees.length === 0) {
      return res.status(400).json({ error: "Task must have at least 1 assignee" });
    }

    // ✅ Validar que los nuevos assignees son miembros del chat
    const chk = await assertUsersAreChatMembers(task.chat, nextAssignees);
    if (!chk.ok) return res.status(chk.code).json({ error: chk.error, badUserIds: chk.badUserIds });

    task.assignees = nextAssignees;

    // ✅ Mantén "assignee" principal sincronizado
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

    // miembro del chat
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
    const isInAssignees = Array.isArray(task.assignees)
      ? task.assignees.map(String).includes(userId)
      : false;

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
        creator: task.creator
          ? { _id: String(task.creator._id), id: String(task.creator._id), name: task.creator.name }
          : null,
        assignee: task.assignee
          ? { _id: String(task.assignee._id), id: String(task.assignee._id), name: task.assignee.name }
          : null,
      },
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
