const express = require("express");
const { auth } = require("../middleware/auth");
const Task = require("../models/Task");
const Chat = require("../models/Chat");
const TaskComment = require("../models/TaskComment");
const { TASK_STATUS } = require("../utils/constants");
const { upload, toPublicUrl } = require("../utils/upload");

const router = express.Router();

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

/**
 * PATCH/POST /tasks/:taskId/toggle
 * - PENDING => DONE (completedAt=now, archivedAt=null)
 * - DONE => PENDING (completedAt=null, archivedAt=null)
 */
async function toggleHandler(req, res, next) {
  try {
    const userId = String(req.user.id);
    const { taskId } = req.params;

    const task = await Task.findById(taskId).select("_id chat status assignee assignees creator completedAt archivedAt");
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
router.post("/:taskId/toggle", auth, toggleHandler); // ✅ por compatibilidad

/**
 * PATCH/POST /tasks/:taskId/archive
 * - Solo si está DONE
 * - archivedAt = now
 */
async function archiveHandler(req, res, next) {
  try {
    const userId = String(req.user.id);
    const { taskId } = req.params;

    const task = await Task.findById(taskId).select("_id chat status assignee assignees creator archivedAt completedAt");
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
router.post("/:taskId/archive", auth, archiveHandler); // ✅ por compatibilidad

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

// ✅ PATCH /tasks/:taskId  (editar dueDate / color)
router.patch("/:taskId", auth, async (req, res, next) => {
  try {
    const userId = String(req.user.id);
    const taskId = String(req.params.taskId);

    const { dueDate, color } = req.body;

    const task = await Task.findById(taskId);
    if (!task) return res.status(404).json({ error: "Task not found" });

    // Permiso básico: creador o responsable
    const isCreator = String(task.creator) === userId;
    const isAssignee = String(task.assignee) === userId;
    const isInAssignees = Array.isArray(task.assignees)
      ? task.assignees.map(String).includes(userId)
      : false;

    if (!isCreator && !isAssignee && !isInAssignees) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // dueDate: si llega null => borrar
    if ("dueDate" in req.body) {
      task.dueDate = dueDate ? new Date(dueDate) : null;
    }

    // color: validar contra TASK_COLORS
    if ("color" in req.body) {
      const c = String(color || "").trim();
      if (c && !TASK_COLORS.includes(c)) {
        return res.status(400).json({ error: "Invalid color" });
      }
      task.color = c || task.color;
    }

    await task.save();

    // devuelve task “bonita” (similar a dashboard)
    const t = await Task.findById(task._id)
      .populate("creator", "name email photoUrl")
      .populate("assignee", "name email photoUrl")
      .populate("chat", "type title")
      .select(
        "_id title color status dueDate chat creator assignee message createdAt completedAt archivedAt attachments"
      );

    return res.json({ ok: true, task: mapTask(t) });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
