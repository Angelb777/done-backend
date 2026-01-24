const express = require("express");
const { auth } = require("../middleware/auth");
const Task = require("../models/Task");
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
    const tab = String(req.query.tab || "TAREAS").toUpperCase(); // TAREAS | HISTORIAL

    const now = new Date();
    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    function buildFilter(base) {
      if (tab === "HISTORIAL") {
        return {
          ...base,
          status: TASK_STATUS.DONE,
          $or: [{ archivedAt: { $ne: null } }, { completedAt: { $lt: since } }],
        };
      }

      // TAREAS (activo)
      return {
        ...base,
        archivedAt: null,
        $or: [
          { status: TASK_STATUS.PENDING },
          { status: TASK_STATUS.DONE, completedAt: { $gte: since } },
        ],
      };
    }

    // ✅ ahora también seleccionamos "attachments"
    const selectFields =
      "_id title color status dueDate chat creator assignee message createdAt completedAt archivedAt attachments";

    const mine = await Task.find(buildFilter({ assignee: userId }))
      .populate("creator", "name email photoUrl")
      .populate("assignee", "name email photoUrl")
      .populate("chat", "type title")
      .select(selectFields);

    const assignedByMe = await Task.find(
      buildFilter({
        creator: userId,
        assignee: { $ne: userId },
      })
    )
      .populate("creator", "name email photoUrl")
      .populate("assignee", "name email photoUrl")
      .populate("chat", "type title")
      .select(selectFields);

    function orderTasks(tasks) {
      const withDue = tasks.filter((t) => t.dueDate);
      const withoutDue = tasks.filter((t) => !t.dueDate);
      withDue.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
      withoutDue.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      return [...withDue, ...withoutDue];
    }

    return res.json({
      tab,
      mine: orderTasks(mine).map(mapTask),
      assignedByMe: orderTasks(assignedByMe).map(mapTask),
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

module.exports = router;
