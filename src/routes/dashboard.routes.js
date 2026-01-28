// src/routes/dashboard.routes.js
const express = require("express");
const mongoose = require("mongoose");
const { auth } = require("../middleware/auth");

const Task = require("../models/Task");
const TaskSubtask = require("../models/TaskSubtask"); // ✅ NUEVO
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
 *
 * ✅ NUEVO:
 *  - subtasks: { total, done } (o null si no hay)
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

    const selectFields =
      "_id title color status dueDate chat creator assignee message createdAt completedAt archivedAt attachments";

     const mineRaw = await Task.find(
       buildFilter({
       $or: [{ assignee: userId }, { assignees: userId }],
       })
       )

      .populate("creator", "name email photoUrl")
      .populate("assignee", "name email photoUrl")
      .populate("chat", "type title")
      .select(selectFields)
      .lean();

     const assignedRaw = await Task.find(
       buildFilter({
       creator: userId,
       assignee: { $ne: userId },
       assignees: { $ne: userId },
       })
       )

      .populate("creator", "name email photoUrl")
      .populate("assignee", "name email photoUrl")
      .populate("chat", "type title")
      .select(selectFields)
      .lean();

    // ----------------------------------------------------
    // ✅ Progreso de subtareas (1 query para todas las tasks)
    // ----------------------------------------------------
    const allTaskIdsStr = [
      ...mineRaw.map((t) => String(t._id)),
      ...assignedRaw.map((t) => String(t._id)),
    ];

    const allTaskIds = allTaskIdsStr
      .filter(Boolean)
      .map((id) => new mongoose.Types.ObjectId(id));

    const subtaskByTaskId = new Map(); // taskId -> { total, done }

    if (allTaskIds.length > 0) {
      const agg = await TaskSubtask.aggregate([
        { $match: { task: { $in: allTaskIds } } },
        {
          $group: {
            _id: "$task",
            total: { $sum: 1 },
            done: { $sum: { $cond: ["$done", 1, 0] } },
          },
        },
      ]);

      for (const r of agg) {
        subtaskByTaskId.set(String(r._id), {
          total: Number(r.total || 0),
          done: Number(r.done || 0),
        });
      }
    }

    function mapTask(t) {
      const atts = Array.isArray(t.attachments) ? t.attachments : [];
      const st = subtaskByTaskId.get(String(t._id)) || { total: 0, done: 0 };

      return {
        id: String(t._id),
        title: t.title,
        color: t.color,
        status: t.status,
        dueDate: t.dueDate || null,
        createdAt: t.createdAt || null,
        completedAt: t.completedAt || null,
        archivedAt: t.archivedAt || null,

        // ✅ NUEVO: progreso subtareas (null si no hay)
        subtasks: st.total > 0 ? st : null,

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

    return res.json({
      tab,
      mine: applyOrderStable(mineRaw, pendingOrder).map(mapTask),
      assignedByMe: applyOrderStable(assignedRaw, requestedOrder).map(mapTask),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
