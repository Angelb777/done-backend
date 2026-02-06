// src/routes/dev_merge.routes.js
const express = require("express");
const User = require("../models/User");
const Chat = require("../models/Chat");
const Message = require("../models/Message");
const Task = require("../models/Task");

const router = express.Router();

/**
 * ✅ MIGRAR datos de un usuario a otro por email
 *
 * GET /dev-merge/merge?fromEmail=...&toEmail=...&key=DEV_KEY
 *
 * Requisitos:
 * - Tener DEV_KEY en Render (Environment Variables)
 * - Usarlo 1 vez y luego BORRAR este router
 */

router.get("/merge", async (req, res, next) => {
  try {
    const key = String(req.query.key || "");
    const DEV_KEY = String(process.env.DEV_KEY || "");

    if (!DEV_KEY) {
      return res.status(500).json({ error: "Falta DEV_KEY en variables de entorno" });
    }
    if (!key || key !== DEV_KEY) {
      return res.status(403).json({ error: "Forbidden (bad key)" });
    }

    const fromEmail = String(req.query.fromEmail || "").trim().toLowerCase();
    const toEmail = String(req.query.toEmail || "").trim().toLowerCase();

    if (!fromEmail || !toEmail) {
      return res.status(400).json({ error: "fromEmail y toEmail son obligatorios" });
    }
    if (fromEmail === toEmail) {
      return res.status(400).json({ error: "fromEmail y toEmail no pueden ser iguales" });
    }

    const fromUser = await User.findOne({ email: fromEmail });
    const toUser = await User.findOne({ email: toEmail });

    if (!fromUser) return res.status(404).json({ error: `No existe fromEmail: ${fromEmail}` });
    if (!toUser) return res.status(404).json({ error: `No existe toEmail: ${toEmail}` });

    const fromId = String(fromUser._id);
    const toId = String(toUser._id);

    // ✅ Guardar chats afectados ANTES de tocarlos
    const chatIds = await Chat.find({ members: fromId }).distinct("_id");

    // 1) Mensajes: sender -> nuevo user
    const messagesRes = await Message.updateMany(
      { sender: fromId },
      { $set: { sender: toId } }
    );

    // 2) Tareas: creator/assignee -> nuevo user
    const tasksCreatorRes = await Task.updateMany(
      { creator: fromId },
      { $set: { creator: toId } }
    );

    const tasksAssigneeRes = await Task.updateMany(
      { assignee: fromId },
      { $set: { assignee: toId } }
    );

    // 3) Chats: reemplazar member (solo en los chats afectados)
    const chatsPullRes = await Chat.updateMany(
      { _id: { $in: chatIds } },
      { $pull: { members: fromId } }
    );

    const chatsAddRes = await Chat.updateMany(
      { _id: { $in: chatIds } },
      { $addToSet: { members: toId } }
    );

    return res.json({
      ok: true,
      fromEmail,
      toEmail,
      fromId,
      toId,
      changed: {
        messagesMatched: messagesRes.matchedCount ?? null,
        messagesModified: messagesRes.modifiedCount ?? null,
        tasksCreatorMatched: tasksCreatorRes.matchedCount ?? null,
        tasksCreatorModified: tasksCreatorRes.modifiedCount ?? null,
        tasksAssigneeMatched: tasksAssigneeRes.matchedCount ?? null,
        tasksAssigneeModified: tasksAssigneeRes.modifiedCount ?? null,
        chatsMatched: chatIds.length,
        chatsPullModified: chatsPullRes.modifiedCount ?? null,
        chatsAddModified: chatsAddRes.modifiedCount ?? null,
      },
      note: "Si ya ves tus tareas/mensajes, borra este router y quita la ruta del app.js.",
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
