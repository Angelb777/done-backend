const express = require("express");
const { auth } = require("../middleware/auth");
const Task = require("../models/Task");
const User = require("../models/User");
const { TASK_STATUS } = require("../utils/constants");

const router = express.Router();

/**
 * GET /dashboard?tab=TAREAS|HISTORIAL
 *
 * TAREAS:
 *  - archivedAt = null
 *  - (status=PENDING) OR (status=DONE AND completedAt >= now-24h)
 *
 * HISTORIAL:
 *  - status=DONE
 *  - (archivedAt != null) OR (completedAt < now-24h)
 *
 * Returns:
 *  - mine: tasks where assignee = me
 *  - assignedByMe: tasks where creator = me AND assignee != me
 */
router.get("/", auth, async (req, res, next) => {
  try {
    const userId = String(req.user.id);
    const tab = String(req.query.tab || "TAREAS").toUpperCase();

    const now = new Date();
    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const me = await User.findById(userId).select("taskOrder").lean();
    const pendingOrder = (me?.taskOrder?.pending || []).map(String);
    const requestedOrder = (me?.taskOrder?.requested || []).map(String);

    function buildFilter(base) {
      if (tab === "HISTORIAL") {
        return {
          ...base,
          status: TASK_STATUS.DONE,
          $or: [{ archivedAt: { $ne: null } }, { completedAt: { $lt: since } }],
        };
      }
      return {
        ...base,
        archivedAt: null,
        $or: [
          { status: TASK_STATUS.PENDING },
          { status: TASK_STATUS.DONE, completedAt: { $gte: since } },
        ],
      };
    }

    function applyOrderStable(tasks, orderIds) {
      const idx = new Map((orderIds || []).map((id, i) => [String(id), i]));
      return [...tasks].sort((a, b) => {
        const aId = String(a._id);
        const bId = String(b._id);

        const ai = idx.has(aId) ? idx.get(aId) : 1e9;
        const bi = idx.has(bId) ? idx.get(bId) : 1e9;
        if (ai !== bi) return ai - bi;

        const ac = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bc = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        if (ac !== bc) return ac - bc;

        // tie-breaker definitivo: evita “se mueve solo”
        return aId.localeCompare(bId);
      });
    }

    function mapTask(t) {
      const atts = Array.isArray(t.attachments) ? t.attachments : [];

      return {
        id: String(t._id),
        title: t.title,
        color: t.color,
        status: t.status,
        dueDate: t.dueDate || null,
        createdAt: t.createdAt || null,
        completedAt: t.completedAt || null,
        archivedAt: t.archivedAt || null,
        attachments: atts
          .map((a) => ({
            url: a?.url || a?.path || "",
            name: a?.name || a?.filename || "",
            mime: a?.mime || a?.mimetype || a?.mimeType || a?.contentType || "",
            size: Number(a?.size || 0),
          }))
          .filter((a) => String(a.url).trim().length > 0),
        chat: t.chat
          ? {
              id: String(t.chat._id),
              title: t.chat.type === "GROUP" ? t.chat.title || "Grupo" : null,
              type: t.chat.type,
            }
          : null,
        creator: t.creator
          ? {
              id: String(t.creator._id),
              name: t.creator.name,
              email: t.creator.email,
              photoUrl: t.creator.photoUrl || null,
            }
          : null,
        assignee: t.assignee
          ? {
              id: String(t.assignee._id),
              name: t.assignee.name,
              email: t.assignee.email,
              photoUrl: t.assignee.photoUrl || null,
            }
          : null,
        messageId: t.message,
      };
    }

    const selectFields =
      "_id title color status dueDate chat creator assignee message createdAt completedAt archivedAt attachments";

    const mineRaw = await Task.find(buildFilter({ assignee: userId }))
      .populate("creator", "name email photoUrl")
      .populate("assignee", "name email photoUrl")
      .populate("chat", "type title")
      .select(selectFields)
      .lean();

    const assignedRaw = await Task.find(
      buildFilter({ creator: userId, assignee: { $ne: userId } })
    )
      .populate("creator", "name email photoUrl")
      .populate("assignee", "name email photoUrl")
      .populate("chat", "type title")
      .select(selectFields)
      .lean();

    return res.json({
      tab,
      mine: applyOrderStable(mineRaw, pendingOrder).map(mapTask),
      assignedByMe: applyOrderStable(assignedRaw, requestedOrder).map(mapTask),
    });
  } catch (err) {
    next(err);
  }
});


function mapTask(t) {
  const atts = Array.isArray(t.attachments) ? t.attachments : [];

  return {
    id: t._id,
    title: t.title,
    color: t.color,
    status: t.status,
    dueDate: t.dueDate || null,
    createdAt: t.createdAt,
    completedAt: t.completedAt || null,
    archivedAt: t.archivedAt || null,

    // ✅ NUEVO: adjuntos de la tarea
    attachments: atts
      .map((a) => ({
        url: a?.url || a?.path || "",
        name: a?.name || a?.filename || "",
        mime: a?.mime || a?.mimetype || a?.mimeType || a?.contentType || "",
        size: Number(a?.size || 0),
      }))
      .filter((a) => String(a.url).trim().length > 0),

    chat: t.chat
      ? {
          id: t.chat._id,
          title: t.chat.type === "GROUP" ? t.chat.title || "Grupo" : null,
          type: t.chat.type,
        }
      : null,

    creator: t.creator
      ? {
          id: t.creator._id,
          name: t.creator.name,
          email: t.creator.email,
          photoUrl: t.creator.photoUrl || null,
        }
      : null,

    assignee: t.assignee
      ? {
          id: t.assignee._id,
          name: t.assignee.name,
          email: t.assignee.email,
          photoUrl: t.assignee.photoUrl || null,
        }
      : null,

    messageId: t.message,
  };
}

/**
 * PATCH /tasks/:taskId
 * body: { dueDate?: string|null, color?: number }
 */
router.patch("/:taskId", auth, async (req, res, next) => {
  try {
    const userId = String(req.user.id);
    const { taskId } = req.params;

    const task = await Task.findById(taskId).select("_id chat status assignee assignees creator dueDate color");
    if (!task) return res.status(404).json({ error: "Task not found" });

    if (!canEdit(task, userId)) return res.status(403).json({ error: "Forbidden" });

    const mem = await assertMember(task, userId);
    if (!mem.ok) return res.status(mem.code).json({ error: mem.error });

    // dueDate
    if ("dueDate" in req.body) {
      const v = req.body.dueDate;
      if (v === null || v === "" || v === "null") {
        task.dueDate = null;
      } else {
        const d = new Date(String(v));
        if (Number.isNaN(d.getTime())) return res.status(400).json({ error: "Invalid dueDate" });
        task.dueDate = d;
      }
    }

    // color 0..9
    if ("color" in req.body) {
      const c = Number(req.body.color);
      if (!Number.isFinite(c) || c < 0 || c > 9) {
        return res.status(400).json({ error: "Invalid color (0..9)" });
      }
      task.color = c;
    }

    await task.save();

    return res.json({
      task: {
        id: String(task._id),
        dueDate: task.dueDate || null,
        color: typeof task.color === "number" ? task.color : 0,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
