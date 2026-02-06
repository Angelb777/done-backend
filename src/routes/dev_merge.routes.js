const express = require("express");
const mongoose = require("mongoose");

const User = require("../models/User");
const Chat = require("../models/Chat");
const Message = require("../models/Message");
const Task = require("../models/Task");

const router = express.Router();

/**
 * Seguridad: DEV_KEY en variables de entorno.
 * Ejemplo en Render: DEV_KEY=tu_clave_larga
 */
function requireDevKey(req, res) {
  const key = String(req.query.key || req.headers["x-dev-key"] || "").trim();
  if (!process.env.DEV_KEY || !key || key !== String(process.env.DEV_KEY)) {
    res.status(401).json({ error: "Unauthorized (DEV_KEY)" });
    return false;
  }
  return true;
}

function normEmail(v) {
  return String(v || "").trim().toLowerCase();
}

async function statsForUser(userId) {
  const [chats, msgs, tasksCreator, tasksAssignee] = await Promise.all([
    Chat.countDocuments({ members: userId }),
    Message.countDocuments({ sender: userId }),
    Task.countDocuments({ creator: userId }),
    Task.countDocuments({ assignee: userId }),
  ]);

  return { chats, msgs, tasksCreator, tasksAssignee };
}

/**
 * GET /dev-merge/lookup?email=...&key=...
 * Te dice si existe el usuario y cuántos datos tiene.
 */
router.get("/lookup", async (req, res, next) => {
  try {
    if (!requireDevKey(req, res)) return;

    const email = normEmail(req.query.email);
    if (!email) return res.status(400).json({ error: "Missing email" });

    const user = await User.findOne({ email }).select("_id email name createdAt");
    if (!user) return res.json({ ok: true, email, exists: false });

    const stats = await statsForUser(user._id);

    return res.json({
      ok: true,
      exists: true,
      user: {
        id: String(user._id),
        email: user.email,
        name: user.name,
        createdAt: user.createdAt,
      },
      stats,
    });
  } catch (e) {
    next(e);
  }
});

/**
 * POST/GET /dev-merge/merge?from=...&to=...&key=...
 * Migra:
 * - Chats: reemplaza member oldId -> newId (y dedupe)
 * - Mensajes: sender oldId -> newId
 * - Tareas: creator/assignee oldId -> newId
 *
 * Devuelve resumen con cantidades.
 */
router.all("/merge", async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    if (!requireDevKey(req, res)) return;

    const fromEmail = normEmail(req.query.from);
    const toEmail = normEmail(req.query.to);

    if (!fromEmail || !toEmail) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: "Missing from/to" });
    }

    if (fromEmail === toEmail) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: "from and to must be different" });
    }

    const [fromUser, toUser] = await Promise.all([
      User.findOne({ email: fromEmail }).session(session),
      User.findOne({ email: toEmail }).session(session),
    ]);

    if (!fromUser) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ error: `from user not found: ${fromEmail}` });
    }
    if (!toUser) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ error: `to user not found: ${toEmail}` });
    }

    const oldId = fromUser._id;
    const newId = toUser._id;

    // --- Chats: sustituye member oldId por newId, y elimina duplicados
    const chats = await Chat.find({ members: oldId }).select("_id members").session(session);

    let chatsTouched = 0;
    for (const c of chats) {
      const members = (c.members || []).map(String);
      const replaced = members.map((m) => (m === String(oldId) ? String(newId) : m));

      // dedupe
      const deduped = Array.from(new Set(replaced));

      // si ha cambiado algo
      if (deduped.join("|") !== members.join("|")) {
        c.members = deduped;
        await c.save({ session });
        chatsTouched++;
      }
    }

    // --- Mensajes
    const msgsRes = await Message.updateMany(
      { sender: oldId },
      { $set: { sender: newId } },
      { session }
    );

    // --- Tareas (creator / assignee)
    const tasksCreatorRes = await Task.updateMany(
      { creator: oldId },
      { $set: { creator: newId } },
      { session }
    );

    const tasksAssigneeRes = await Task.updateMany(
      { assignee: oldId },
      { $set: { assignee: newId } },
      { session }
    );

    // (Opcional) juntar tokens push si quieres
    // OJO: no obligatorio para el merge de datos
    await User.updateOne(
      { _id: newId },
      { $addToSet: { fcmTokens: { $each: fromUser.fcmTokens || [] } } },
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    // stats after
    const after = await statsForUser(newId);

    return res.json({
      ok: true,
      from: { email: fromEmail, id: String(oldId) },
      to: { email: toEmail, id: String(newId) },
      changed: {
        chatsTouched,
        messagesModified: msgsRes?.modifiedCount ?? 0,
        tasksCreatorModified: tasksCreatorRes?.modifiedCount ?? 0,
        tasksAssigneeModified: tasksAssigneeRes?.modifiedCount ?? 0,
      },
      toUserStatsAfter: after,
    });
  } catch (e) {
    try {
      await session.abortTransaction();
    } catch (_) {}
    session.endSession();
    next(e);
  }
});

module.exports = router;
