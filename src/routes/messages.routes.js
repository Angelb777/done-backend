const express = require("express");

const Chat = require("../models/Chat");
const Message = require("../models/Message");
const Task = require("../models/Task");
const { auth } = require("../middleware/auth");
const { sendMessageSchema, updateTaskStatusSchema } = require("../utils/validators");
const { MESSAGE_TYPES, TASK_STATUS } = require("../utils/constants");
const User = require("../models/User");


// ✅ Reutilizar upload centralizado
const { upload, toPublicUrl } = require("../utils/upload");

const router = express.Router();

function isImageMime(mime) {
  return typeof mime === "string" && mime.startsWith("image/");
}

function buildAttachments(m) {
  const out = [];

  // preferimos attachments (nuevo)
  if (Array.isArray(m.attachments)) {
    for (const a of m.attachments) {
      if (!a?.url) continue;
      out.push({
        url: a.url,
        name: a.name,
        mime: a.mime,
        size: a.size,
      });
    }
  }

  // fallback legacy SOLO si NO hay attachments
  if (!out.length && m.attachment?.url) {
    out.push({
      url: m.attachment.url,
      name: m.attachment.name,
      mime: m.attachment.mime,
      size: m.attachment.size,
    });
  }

  // dedupe por url
  const seen = new Set();
  return out.filter(a => {
    const k = a.url;
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ---------------------------
// Send message (normal or task)
// ---------------------------
router.post("/send", auth, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const data = sendMessageSchema.parse(req.body);

    const chat = await Chat.findById(data.chatId);
    if (!chat) return res.status(404).json({ error: "Chat not found" });
    if (!chat.members.map(String).includes(String(userId))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const scheduledFor = data.scheduledFor ? new Date(data.scheduledFor) : null;
    const isScheduled = Boolean(scheduledFor && scheduledFor.getTime() > Date.now());

    const type = (data.type || req.body.type || MESSAGE_TYPES.NORMAL);

    const me = await User.findById(userId).select("name email");
    const senderName = me?.name || me?.email || "Usuario";

    const msg = await Message.create({
      chat: data.chatId,
      sender: userId,
      senderName,
      type,
      text: data.text || null,
      imageUrl: data.imageUrl || null,
      isScheduled,
      scheduledFor: scheduledFor || null,
      publishedAt: isScheduled ? undefined : new Date(),
    });

    if (data.type === MESSAGE_TYPES.TASK) {
      if (!data.task) return res.status(400).json({ error: "task payload required for TASK messages" });

      const assigneeId = data.task.assigneeId || userId;

      const task = await Task.create({
        chat: data.chatId,
        message: msg._id,
        creator: userId,
        assignee: assigneeId,
        title: data.task.title,
        color: data.task.color || "gray",
        dueDate: data.task.dueDate ? new Date(data.task.dueDate) : null,
        status: TASK_STATUS.PENDING,
      });

      msg.task = task._id;
      await msg.save();
    }

    if (!isScheduled) {
      const preview =
        data.type === MESSAGE_TYPES.TASK ? `🧩 ${data.task?.title || data.text || "Tarea"}` : data.text || "Mensaje";

      await Chat.updateOne(
        { _id: data.chatId },
        { $set: { lastMessageAt: msg.publishedAt, lastMessagePreview: preview } }
      );
    }

    return res.json({
  message: {
    id: msg._id,
    chatId: msg.chat,
    type: msg.type,
    text: msg.text || null,

    attachment: msg.attachment || null,
    attachments: [
      ...(msg.attachment
        ? [{
            url: msg.attachment.url,
            name: msg.attachment.name,
            mime: msg.attachment.mime,
            size: msg.attachment.size,
          }]
        : []),
      ...(msg.attachments || []).map((a) => ({
        url: a.url,
        name: a.name,
        mime: a.mime,
        size: a.size,
      })),
    ],

    publishedAt: msg.publishedAt || null,

    sender: { _id: String(userId) },
    senderName: msg.senderName || senderName, // ✅ AQUÍ
    taskId: msg.task || null,
  },
});
  } catch (err) {
    next(err);
  }
});

// ---------------------------
// Upload files to chat
// POST /messages/upload (multipart)
// fields: chatId, text(optional)
// files: files[]
// ---------------------------
router.post("/upload", auth, upload.array("files", 8), async (req, res, next) => {
  try {
    const userId = req.user.id;
    const chatId = String(req.body.chatId || "").trim();
    const text = String(req.body.text || "").trim();

    if (!chatId) return res.status(400).json({ error: "chatId required" });

    const chat = await Chat.findById(chatId);
    if (!chat) return res.status(404).json({ error: "Chat not found" });
    if (!chat.members.map(String).includes(String(userId))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const me = await User.findById(userId).select("name email");
    const senderName = me?.name || me?.email || "Usuario";

    const files = req.files || [];
    if (!Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    const created = [];
    const now = new Date();

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const mime = f.mimetype || "";
      const isImg = isImageMime(mime);

      const filename = f.filename;
      const url = toPublicUrl(req, filename);

      const att = {
        url,
        name: f.originalname || filename,
        mime: mime || "application/octet-stream",
        size: typeof f.size === "number" ? f.size : 0,
      };

      const msg = await Message.create({
        chat: chatId,
        sender: userId,
        senderName,
        type: isImg ? MESSAGE_TYPES.IMAGE : MESSAGE_TYPES.FILE,
        text: i === 0 ? (text || null) : null,

        // legacy opcional
        imageUrl: isImg ? url : null,

        // legacy
        attachment: att,

        // ✅ NUEVO
        attachments: [att],

        isScheduled: false,
        scheduledFor: null,
        publishedAt: now,
      });

      created.push(msg);
    }

    const preview =
      text
        ? `📎 ${text}`
        : (created[0].type === MESSAGE_TYPES.IMAGE ? "🖼️ Foto" : "📎 Archivo");

    await Chat.updateOne(
      { _id: chatId },
      { $set: { lastMessageAt: now, lastMessagePreview: preview } }
    );

    return res.json({
      messages: created.map((m) => ({
        id: m._id,
        chatId: String(m.chat),
        type: m.type,
        text: m.text || null,
        imageUrl: m.imageUrl || null,

        attachment: m.attachment
          ? {
              url: m.attachment.url,
              name: m.attachment.name,
              mime: m.attachment.mime,
              size: m.attachment.size,
            }
          : null,

        attachments: [
          ...(m.attachment
            ? [
                {
                  url: m.attachment.url,
                  name: m.attachment.name,
                  mime: m.attachment.mime,
                  size: m.attachment.size,
                },
              ]
            : []),
          ...(m.attachments || []).map((a) => ({
            url: a.url,
            name: a.name,
            mime: a.mime,
            size: a.size,
          })),
        ],

        publishedAt: m.publishedAt,
        sender: { _id: String(userId) },
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------
// Task status
// ---------------------------
router.post("/task/status", auth, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const data = updateTaskStatusSchema.parse(req.body);

    const task = await Task.findById(data.taskId);
    if (!task) return res.status(404).json({ error: "Task not found" });

    if (![String(task.assignee), String(task.creator)].includes(String(userId))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    task.status = data.status;

    if (data.status === TASK_STATUS.DONE) {
      task.completedAt = new Date();
      task.completionNote = data.completionNote || null;
      task.completionImageUrl = data.completionImageUrl || null;
    } else {
      task.completedAt = null;
      task.completionNote = null;
      task.completionImageUrl = null;
    }

    await task.save();

    return res.json({
      task: {
        id: task._id,
        status: task.status,
        completedAt: task.completedAt || null,
        completionNote: task.completionNote || null,
        completionImageUrl: task.completionImageUrl || null,
      },
    });
  } catch (err) {
    next(err);
  }
});

// =====================================================
// WEB ROUTES "BONITAS" (NO ROMPEN FLUTTER)
// =====================================================

// GET /chats/:chatId/messages
router.get("/chats/:chatId/messages", auth, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const chatId = req.params.chatId;

    const chat = await Chat.findById(chatId);
    if (!chat) return res.status(404).json({ error: "Chat not found" });
    if (!chat.members.map(String).includes(String(userId))) {
      return res.status(403).json({ error: "Forbidden" });
    }


    const msgs = await Message.find({ chat: chatId }).sort({ publishedAt: 1, createdAt: 1 });

    // normaliza a formato compatible con Flutter/web
    return res.json(
      msgs.map((m) => ({
        id: m._id,
        chatId: String(m.chat),
        type: m.type,
        text: m.text || "",
        imageUrl: m.imageUrl || null,

        attachments: [
          ...(m.attachment
            ? [{
                url: m.attachment.url,
                name: m.attachment.name,
                mime: m.attachment.mime,
                size: m.attachment.size,
              }]
            : []),
          ...(m.attachments || []).map((a) => ({
            url: a.url,
            name: a.name,
            mime: a.mime,
            size: a.size,
          })),
        ],

        createdAt: (m.publishedAt || m.createdAt),
        senderId: String(m.sender),
        senderName: m.senderName || "Usuario",
        taskId: m.task || null,
        taskStatus: null, // si quieres, luego lo rellenamos mirando Task
        taskAttachments: [], // idem
      }))
    );
  } catch (err) {
    next(err);
  }
});

router.post("/chats/:chatId/messages", auth, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const chatId = req.params.chatId;
    const text = String(req.body?.text || "").trim();

    if (!text) return res.status(400).json({ error: "Mensaje vacío" });

    const chat = await Chat.findById(chatId);
    if (!chat) return res.status(404).json({ error: "Chat not found" });
    if (!chat.members.map(String).includes(String(userId))) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const me = await User.findById(userId).select("name email");
    const senderName = me?.name || me?.email || "Usuario";

    const msg = await Message.create({
      chat: chatId,
      sender: userId,
      senderName,
      type: MESSAGE_TYPES.NORMAL,
      text,
      isScheduled: false,
      scheduledFor: null,
      publishedAt: new Date(),
      attachments: [],
    });

    await Chat.updateOne(
      { _id: chatId },
      { $set: { lastMessageAt: msg.publishedAt, lastMessagePreview: text } }
    );

    return res.json({
      ok: true,
      message: {
        id: msg._id,
        chatId: String(msg.chat),
        type: msg.type,
        text: msg.text || "",
        attachments: [],
        createdAt: msg.publishedAt,
        senderId: String(userId),
        senderName: msg.senderName,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /chats/:chatId/messages/files  (multipart)
// fields: text (opcional) + files[]
router.post("/chats/:chatId/messages/files", auth, upload.array("files", 8), async (req, res, next) => {
  try {
    const userId = req.user.id;
    const chatId = req.params.chatId;
    const text = String(req.body.text || "").trim();

    const chat = await Chat.findById(chatId);
    if (!chat) return res.status(404).json({ error: "Chat not found" });
    if (!chat.members.map(String).includes(String(userId))) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const me = await User.findById(userId).select("name email");
    const senderName = me?.name || me?.email || "Usuario";


    const files = req.files || [];
    if (!files.length && !text) return res.status(400).json({ error: "Sin texto ni adjuntos" });

    const atts = files.map((f) => {
  const url = toPublicUrl(req, f.filename); // <- ahora relativo
  return {
    url,
    name: f.originalname || f.filename,
    mime: f.mimetype || "application/octet-stream",
    size: typeof f.size === "number" ? f.size : 0,
  };
});

const msg = await Message.create({
  chat: chatId,
  sender: userId,
  senderName,
  type: atts.some(a => isImageMime(a.mime)) ? MESSAGE_TYPES.IMAGE : MESSAGE_TYPES.FILE,
  text: text || null,

  // 👇 si quieres mantener legacy, ok, pero NO lo uses para render
  imageUrl: null,        // <- yo lo quitaría ya
  attachment: null,      // <- yo lo quitaría ya

  attachments: atts,

  isScheduled: false,
  scheduledFor: null,
  publishedAt: new Date(),
});

    const preview = text ? `📎 ${text}` : (msg.type === MESSAGE_TYPES.IMAGE ? "🖼️ Foto" : "📎 Archivo");
    await Chat.updateOne(
      { _id: chatId },
      { $set: { lastMessageAt: msg.publishedAt, lastMessagePreview: preview } }
    );

    return res.json({
  ok: true,
  message: {
    id: msg._id,
    chatId: String(msg.chat),
    type: msg.type,
    text: msg.text || "",
    imageUrl: null,                 // <- o quítalo del response
    attachment: null,               // <- o quítalo del response
    attachments: buildAttachments(msg),
    createdAt: msg.publishedAt,
    senderId: String(userId),
    senderName: msg.senderName,
  },
});

  } catch (err) {
    next(err);
  }
});

module.exports = router;
