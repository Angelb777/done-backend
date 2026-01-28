const express = require("express");
const Chat = require("../models/Chat");
const Message = require("../models/Message");
const User = require("../models/User");
const { auth } = require("../middleware/auth");
const { createChatSchema } = require("../utils/validators");
const Task = require("../models/Task");
const { MESSAGE_TYPES, TASK_STATUS } = require("../utils/constants");
const TaskComment = require("../models/TaskComment"); // (lo usaremos luego para files, no rompe ahora)
const { upload, toPublicUrl } = require("../utils/upload");
const multer = require("multer");


const fs = require("fs");
const path = require("path");


const router = express.Router();

// ===============================
// Upload foto de grupo (chat photo)
// ===============================
const chatPhotoDir = path.join(process.cwd(), "uploads", "chat-photos");
fs.mkdirSync(chatPhotoDir, { recursive: true });

const chatPhotoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, chatPhotoDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase() || ".jpg";
    cb(null, `chat_${Date.now()}_${Math.random().toString(16).slice(2)}${ext}`);
  },
});

function chatPhotoFilter(req, file, cb) {
  const ok = String(file.mimetype || "").toLowerCase().startsWith("image/");
  if (!ok) return cb(new Error("Only image files are allowed"), false);
  cb(null, true);
}

const uploadChatPhoto = multer({
  storage: chatPhotoStorage,
  fileFilter: chatPhotoFilter,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
});

function pickPeer(members, myId) {
  const me = String(myId);
  const peer = members.find((m) => String(m._id ?? m.id ?? m) !== me);
  return peer || null;
}

// List chats for current user
// List chats for current user
router.get("/", auth, async (req, res, next) => {
  try {
    const userId = req.user.id;

    const chats = await Chat.find({ members: userId })
      .sort({ lastMessageAt: -1, updatedAt: -1 })
      .limit(100)
      .select("_id type title photoUrl members reads lastMessageAt lastMessagePreview updatedAt")
      .populate("members", "name email photoUrl status");

    // ✅ calcular pendingTasksCount por chat (PENDING y no archivadas)
    const pendingCounts = await Promise.all(
      chats.map(async (c) => {
        const count = await Task.countDocuments({
          chat: c._id,
          status: TASK_STATUS.PENDING,
          $or: [{ archivedAt: null }, { archivedAt: { $exists: false } }],
        });
        return count;
      })
    );

    // ✅ calcular unreadCount por chat según reads.lastReadAt (y publishedAt de mensajes)
const unreadCounts = await Promise.all(
  chats.map(async (c) => {
    const me = String(userId);

    const readState = (c.reads || []).find((r) => String(r.user) === me);
    const lastReadAt = readState?.lastReadAt ? new Date(readState.lastReadAt) : new Date(0);

    const count = await Message.countDocuments({
      chat: c._id,
      publishedAt: { $exists: true, $gt: lastReadAt },
      sender: { $ne: userId }, // no contar tus propios mensajes
     });

     return count;
     })
    );


    return res.json({
      chats: chats.map((c, idx) => {
        const members = (c.members || []).map((m) => ({
          id: String(m._id),
          name: m.name,
          email: m.email,
          photoUrl: m.photoUrl || null,
          status: m.status || "",
        }));

        const pendingTasksCount = pendingCounts[idx] || 0;

        // DM
        if (c.type === "DM") {
          const peer = pickPeer(c.members, userId);
          const peerObj = peer
            ? {
                id: String(peer._id),
                name: peer.name,
                email: peer.email,
                photoUrl: peer.photoUrl || null,
                status: peer.status || "",
              }
            : null;

          const displayTitle =
            (c.title && String(c.title).trim()) ||
            peerObj?.name ||
            peerObj?.email ||
            "Chat";

          return {
            id: c._id,
            type: c.type,
            title: c.title || null,
            displayTitle,
            peer: peerObj,

            // ✅ para DM, la foto del chat es la del peer
            photoUrl: peerObj?.photoUrl || null,

            members,
            lastMessageAt: c.lastMessageAt || null,
            lastMessagePreview: c.lastMessagePreview || null,

            // ✅ AQUÍ
            pendingTasksCount,
            unreadCount: unreadCounts[idx] || 0,
          };
        }

        // GROUP
        const displayTitle = (c.title && String(c.title).trim()) || "Grupo";

        return {
          id: c._id,
          type: c.type,
          title: c.title || null,
          displayTitle,
          peer: null,

          // ✅ para GROUP, la foto es la del propio chat/grupo
          photoUrl: c.photoUrl || null,

          members,
          lastMessageAt: c.lastMessageAt || null,
          lastMessagePreview: c.lastMessagePreview || null,

          // ✅ AQUÍ
          pendingTasksCount,
          unreadCount: unreadCounts[idx] || 0,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});


// Create chat (DM or GROUP)
// Create chat (DM or GROUP)  ✅ JSON o multipart con foto
router.post("/", auth, uploadChatPhoto.single("photo"), async (req, res, next) => {
  try {
    const userId = req.user.id;

    const isMultipart = String(req.headers["content-type"] || "").includes("multipart/form-data");

    let data;

    if (isMultipart) {
      // multipart: fields vienen como strings
      const type = String(req.body.type || "").toUpperCase();

      // memberIds viene como JSON string: '["id1","id2"]'
      let memberIds = [];
      try {
        memberIds = JSON.parse(req.body.memberIds || "[]");
      } catch (_) {
        memberIds = [];
      }
      if (!Array.isArray(memberIds)) memberIds = [];

      const title = String(req.body.title || req.body.name || "").trim();

      data = {
        type,
        title,
        memberIds: memberIds.map(String).filter(Boolean),
      };
    } else {
      // json: como lo tenías
      const parsed = createChatSchema.safeParse(req.body);
      data = parsed.success ? parsed.data : req.body;
      data.title = String(data.title || data.name || "").trim();
    }

    // ✅ members únicos (incluye al creador siempre)
    const uniqueMembers = Array.from(new Set([String(userId), ...(data.memberIds || []).map(String)]));

    // For DM, avoid duplicates
    if (data.type === "DM" && uniqueMembers.length === 2) {
      const existing = await Chat.findOne({
        type: "DM",
        members: { $all: uniqueMembers, $size: 2 },
      }).populate("members", "name email photoUrl status");

      if (existing) {
        const peer = pickPeer(existing.members, userId);
        const peerObj = peer
          ? {
              id: String(peer._id),
              name: peer.name,
              email: peer.email,
              photoUrl: peer.photoUrl || null,
              status: peer.status || "",
            }
          : null;

        const displayTitle =
          (existing.title && String(existing.title).trim()) ||
          peerObj?.name ||
          peerObj?.email ||
          "Chat";

        return res.json({
          chat: {
            id: existing._id,
            type: existing.type,
            title: existing.title || null,
            displayTitle,
            peer: peerObj,
            photoUrl: peerObj?.photoUrl || null,
            members: (existing.members || []).map((m) => ({
              id: String(m._id),
              name: m.name,
              email: m.email,
              photoUrl: m.photoUrl || null,
              status: m.status || "",
            })),
          },
        });
      }
    }

    // ✅ si es grupo y viene foto en multipart, la guardamos
    let groupPhotoUrl = data.photoUrl || null;
    if (data.type === "GROUP" && req.file?.filename) {
      groupPhotoUrl = `/uploads/chat-photos/${req.file.filename}`;
    }

    console.log("CREATE CHAT incoming:", {
    contentType: req.headers["content-type"],
    body: req.body,
    file: !!req.file,
    parsedData: data,
    });

    const chat = await Chat.create({
      type: data.type,
      title: data.type === "GROUP" ? (data.title || "Grupo") : undefined,
      photoUrl: data.type === "GROUP" ? (groupPhotoUrl || null) : undefined,
      members: uniqueMembers,
    });

    const full = await Chat.findById(chat._id).populate("members", "name email photoUrl status");

    const peer = full.type === "DM" ? pickPeer(full.members, userId) : null;
    const peerObj =
      peer && full.type === "DM"
        ? {
            id: String(peer._id),
            name: peer.name,
            email: peer.email,
            photoUrl: peer.photoUrl || null,
            status: peer.status || "",
          }
        : null;

    const displayTitle =
      full.type === "DM"
        ? ((full.title && String(full.title).trim()) || peerObj?.name || peerObj?.email || "Chat")
        : ((full.title && String(full.title).trim()) || "Grupo");

    return res.json({
      chat: {
        id: full._id,
        type: full.type,
        title: full.title || null,
        displayTitle,
        peer: peerObj,
        photoUrl: full.type === "DM" ? (peerObj?.photoUrl || null) : (full.photoUrl || null),
        members: (full.members || []).map((m) => ({
          id: String(m._id),
          name: m.name,
          email: m.email,
          photoUrl: m.photoUrl || null,
          status: m.status || "",
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ✅ GET /chats/personal  -> crea (si no existe) tu chat PERSONAL
router.get("/personal", auth, async (req, res, next) => {
  try {
    const userId = String(req.user.id);

    let chat = await Chat.findOne({
      type: "PERSONAL",
      members: userId,
    });

    if (!chat) {
      chat = await Chat.create({
        type: "PERSONAL",
        title: "Mis tareas",
        members: [userId],
      });
    }

    return res.json({ chatId: String(chat._id), title: chat.title || "Mis tareas" });
  } catch (e) {
    next(e);
  }
});

// Delete chat (and its conversation + files/messages/comments)
// NOTE: Tasks are NOT deleted (they may still appear in dashboard)
router.delete("/:chatId", auth, async (req, res, next) => {
  try {
    const userId = String(req.user.id);
    const { chatId } = req.params;

    const filesToDelete = [];

const chat = await Chat.findById(chatId).select("_id members photoUrl");
if (!chat) return res.status(404).json({ error: "Chat not found" });

if (chat.photoUrl) filesToDelete.push(chat.photoUrl);

const members = (chat.members || []).map(String);
if (!members.includes(userId)) return res.status(403).json({ error: "Forbidden" });

// 1) Collect attachment URLs to delete from disk ...

    // Messages attachments
    const msgs = await Message.find({ chat: chatId }).select("attachment attachments imageUrl");
    for (const m of msgs) {
      if (m.imageUrl) filesToDelete.push(m.imageUrl);

      if (m.attachment?.url) filesToDelete.push(m.attachment.url);

      for (const a of (m.attachments || [])) {
        if (a?.url) filesToDelete.push(a.url);
      }
    }

    // TaskComments attachments
    const comments = await TaskComment.find({ chat: chatId }).select("attachments");
    for (const c of comments) {
      for (const a of (c.attachments || [])) {
        if (a?.url) filesToDelete.push(a.url);
      }
    }

    // ⚠️ Tasks: NO se borran (por tu requisito)
    // Si además quieres borrar ficheros subidos en tareas, DESCOMENTA esto:
    /*
    const tasks = await Task.find({ chat: chatId }).select("attachments");
    for (const t of tasks) {
      for (const a of (t.attachments || [])) {
        if (a?.url) filesToDelete.push(a.url);
      }
    }
    */

    // 2) Delete DB data (conversation)
    await Message.deleteMany({ chat: chatId });
    await TaskComment.deleteMany({ chat: chatId });

    // 3) Delete the chat itself
    await Chat.findByIdAndDelete(chatId);

    // 4) Delete physical files in /uploads (best effort)
    // supports urls like: http://host/uploads/xxx OR /uploads/xxx
    const unique = Array.from(new Set(filesToDelete)).filter(Boolean);

    for (const u of unique) {
      try {
        const s = String(u);
        const idx = s.indexOf("/uploads/");
        if (idx === -1) continue;

        const rel = s.substring(idx); // "/uploads/xxx"
        const filePath = path.join(process.cwd(), rel); // backend root + /uploads/xxx
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (_) {
        // ignore file delete errors
      }
    }

    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Get one chat (for SendTaskScreen -> members list)
router.get("/:chatId", auth, async (req, res, next) => {
  try {
    const userId = String(req.user.id);
    const { chatId } = req.params;

    const chat = await Chat.findById(chatId)
      .select("_id type title photoUrl members")
      .populate("members", "name email photoUrl status");

    if (!chat) return res.status(404).json({ error: "Chat not found" });

    const membersIds = (chat.members || []).map((m) => String(m._id));
    if (!membersIds.includes(userId)) return res.status(403).json({ error: "Forbidden" });

    return res.json({
      chat: {
        id: String(chat._id),
        type: chat.type,
        title: chat.title || null,
        photoUrl: chat.photoUrl || null,
        members: (chat.members || []).map((m) => ({
          _id: String(m._id), // 👈 importante (tu Flutter lee _id o id)
          name: m.name,
          email: m.email,
          photoUrl: m.photoUrl || null,
          status: m.status || "",
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

// Get messages in a chat
router.get("/:chatId/messages", auth, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { chatId } = req.params;
    const limit = Math.min(Number(req.query.limit || 30), 100);
    const before = req.query.before ? new Date(String(req.query.before)) : null;

    const chat = await Chat.findById(chatId);
    if (!chat) return res.status(404).json({ error: "Chat not found" });
    if (!chat.members.map(String).includes(String(userId))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const query = { chat: chatId, publishedAt: { $exists: true } };
    if (before) query.publishedAt = { $lt: before };

    const messages = await Message.find(query)
      .populate("sender", "name email photoUrl status")
      .populate({
  path: "task",
  populate: [
    { path: "assignee", select: "name email photoUrl status" },
    { path: "assignees", select: "name email photoUrl status" }, // ✅ NUEVO
    { path: "creator", select: "name email photoUrl status" },
  ],
})
      .sort({ publishedAt: -1 })
      .limit(limit);

    return res.json({
  messages: messages
    .reverse()
    .map((m) => ({
      id: m._id,
      chatId: m.chat,
      type: m.type,
      text: m.text || null,
      imageUrl: m.imageUrl || null,

      // ✅ AÑADIR ESTO
      attachment: m.attachment
        ? {
            url: m.attachment.url,
            name: m.attachment.name,
            mime: m.attachment.mime,
            size: m.attachment.size,
          }
        : null,

        // ✅ NUEVO: lista unificada (si hay attachment singular, lo incluimos también)
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

       sender: {
        id: m.sender?._id,
        name: m.sender?.name,
        email: m.sender?.email,
        photoUrl: m.sender?.photoUrl || null,
        status: m.sender?.status || "",
       },
       publishedAt: m.publishedAt,
       task: m.task
  ? {
      id: m.task._id,
      title: m.task.title,
      color: m.task.color,
      status: m.task.status,
      dueDate: m.task.dueDate || null,

      attachments: (m.task.attachments || []).map((a) => ({
        url: a.url,
        name: a.name,
        mime: a.mime,
        size: a.size,
      })),

      assignee: m.task.assignee
        ? {
            id: m.task.assignee._id,
            name: m.task.assignee.name,
            email: m.task.assignee.email,
            photoUrl: m.task.assignee.photoUrl || null,
            status: m.task.assignee.status || "",
          }
        : null,

      // ✅ AQUÍ VA ESTO:
      assignees: (m.task.assignees || []).map((u) => ({
        id: String(u._id),
        name: u.name,
        email: u.email,
        photoUrl: u.photoUrl || null,
        status: u.status || "",
      })),

      creator: m.task.creator
        ? {
            id: String(m.task.creator._id),
            name: m.task.creator.name,
            email: m.task.creator.email,
            photoUrl: m.task.creator.photoUrl || null,
            status: m.task.creator.status || "",
          }
        : null,

      completedAt: m.task.completedAt || null,
      completionNote: m.task.completionNote || null,
      completionImageUrl: m.task.completionImageUrl || null,
    }
  : null,
    })),
});
  } catch (err) {
    next(err);
  }
});

// Create task in a chat (and also create a TASK message)
router.post("/:chatId/tasks", auth, upload.array("files", 10), async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { chatId } = req.params;

    const title = String(req.body.title || req.body.description || "").trim();
    const dueDateRaw = req.body.dueDate ? new Date(req.body.dueDate) : null;

    if (!title) return res.status(400).json({ error: "title is required" });
        const files = req.files || [];
    const attachments = files.map((f) => ({
      url: toPublicUrl(req, f.filename),
      name: f.originalname,
      mime: f.mimetype,
      size: f.size,
    }));

    if (dueDateRaw && Number.isNaN(dueDateRaw.getTime())) {
      return res.status(400).json({ error: "dueDate invalid" });
    }

    const chat = await Chat.findById(chatId).select("_id type members");
    if (!chat) return res.status(404).json({ error: "Chat not found" });

    const members = chat.members.map(String);
    if (!members.includes(String(userId))) {
      return res.status(403).json({ error: "Forbidden" });
    }

        // ✅ NUEVO: soportar assigneeIds (uno o varios) + default "todos" en grupo
    let assigneeIds = [];

    // helper: parse assigneeIds tanto si viene JSON normal (array),
    // como si viene multipart (string json)
    function parseAssigneeIds(raw) {
      if (!raw) return [];
      if (Array.isArray(raw)) return raw.map(String);
      if (typeof raw === "string") {
        const s = raw.trim();
        if (!s) return [];
        try {
          const parsed = JSON.parse(s);
          if (Array.isArray(parsed)) return parsed.map(String);
        } catch (_) {
          // fallback: "id1,id2"
          if (s.includes(",")) return s.split(",").map((x) => x.trim()).filter(Boolean);
          return [s];
        }
      }
      return [];
    }

    if (chat.type === "DM") {
      // DM: siempre el otro
      const peerId = members.find((m) => m !== String(userId));
      assigneeIds = peerId ? [String(peerId)] : [];
    } else {
      // GROUP:
      // 1) intentamos assigneeIds (nuevo)
      assigneeIds = parseAssigneeIds(req.body.assigneeIds);

      // 2) compat: si te llega el antiguo assigneeId, lo convertimos
      if (assigneeIds.length === 0 && req.body.assigneeId) {
        assigneeIds = [String(req.body.assigneeId)];
      }

      // 3) si no viene nada -> por defecto TODOS
      if (assigneeIds.length === 0) {
        assigneeIds = [...members]; // todos los miembros
      }

      // validar que todos son miembros del chat
      const bad = assigneeIds.find((id) => !members.includes(String(id)));
      if (bad) {
        return res.status(400).json({ error: "assigneeIds contains non-member user" });
      }
    }

    if (!assigneeIds || assigneeIds.length === 0) {
      return res.status(400).json({ error: "No assignees resolved" });
    }

    const primaryAssigneeId = String(assigneeIds[0]);

    const msg = await Message.create({
      chat: chatId,
      sender: userId,
      type: MESSAGE_TYPES.TASK,
      text: title,
      publishedAt: new Date(),
      task: null,
    });

      const task = await Task.create({
      chat: chatId,
      message: msg._id,
      creator: userId,
      title,

      // ✅ NUEVO
      assignees: assigneeIds,
      assignee: primaryAssigneeId, // compat

      dueDate: dueDateRaw,
      status: TASK_STATUS.PENDING,
      attachments,
    });


    msg.task = task._id;
    await msg.save();

    await Chat.findByIdAndUpdate(chatId, {
      lastMessageAt: msg.publishedAt,
      lastMessagePreview: `🧩 ${title}`,
    });

    return res.json({
      task: {
        id: task._id,
        title: task.title,
        dueDate: task.dueDate || null,
        status: task.status,
        creator: String(task.creator),
        assignee: String(task.assignee),
        assignees: (task.assignees || []).map(String),
        createdAt: task.createdAt,
        attachments: task.attachments || [],
      },
      message: {
        id: msg._id,
        chatId: String(msg.chat),
        type: msg.type,
        text: msg.text || null,
        sender: String(msg.sender),
        publishedAt: msg.publishedAt,
        task: {
          id: task._id,
          title: task.title,
          dueDate: task.dueDate || null,
          status: task.status,
          attachments: task.attachments || [],
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

// Update task status (DONE/PENDING) within a chat
router.patch("/:chatId/tasks/:taskId", auth, async (req, res, next) => {
  try {
    const userId = String(req.user.id);
    const { chatId, taskId } = req.params;

    const statusRaw = String(req.body.status || "").toUpperCase();
    if (!["DONE", "PENDING"].includes(statusRaw)) {
      return res.status(400).json({ error: "status must be DONE or PENDING" });
    }

    const chat = await Chat.findById(chatId).select("_id members");
    if (!chat) return res.status(404).json({ error: "Chat not found" });

    const members = (chat.members || []).map(String);
    if (!members.includes(userId)) return res.status(403).json({ error: "Forbidden" });

    const task = await Task.findById(taskId);
    if (!task) return res.status(404).json({ error: "Task not found" });

    if (String(task.chat) !== String(chatId)) {
      return res.status(400).json({ error: "Task does not belong to this chat" });
    }

    const isCreator = String(task.creator) === userId;
    const isAssignee = (task.assignees || []).map(String).includes(userId) || String(task.assignee) === userId;

    if (!isCreator && !isAssignee) {
    return res.status(403).json({ error: "Only creator or assignee can update this task" });
    }

    task.status = statusRaw;
    task.completedAt = statusRaw === "DONE" ? new Date() : null;
    await task.save();

    return res.json({
      task: {
        id: task._id,
        chatId: String(task.chat),
        status: task.status,
        completedAt: task.completedAt || null,
      },
    });
  } catch (err) {
    next(err);
  }
});

function normalizeTypeParam(t) {
  const v = String(t || "all").toLowerCase();
  if (v === "images" || v === "image") return "images";
  if (v === "docs" || v === "documents" || v === "files") return "docs";
  return "all";
}

function matchesType(att, type) {
  const mime = String(att?.mime || "").toLowerCase();
  const isImg = mime.startsWith("image/");
  if (type === "images") return isImg;
  if (type === "docs") return !isImg;
  return true;
}

function senderDto(u) {
  if (!u) return { id: null, name: "Unknown", photoUrl: null, status: "" };
  return {
    id: String(u._id),
    name: u.name || "",
    photoUrl: u.photoUrl || null,
    status: u.status || "",
  };
}

// ✅ Gallery endpoint
router.get("/:chatId/files", auth, async (req, res, next) => {
  try {
    const userId = String(req.user.id);
    const { chatId } = req.params;

    const type = normalizeTypeParam(req.query.type);
    const limit = Math.min(Number(req.query.limit || 60), 200);
    const before = req.query.before ? new Date(String(req.query.before)) : null;
    const beforeOk = before && !Number.isNaN(before.getTime());

    const chat = await Chat.findById(chatId).select("_id members");
    if (!chat) return res.status(404).json({ error: "Chat not found" });
    if (!(chat.members || []).map(String).includes(userId)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // 1) Messages (attachments + legacy attachment)
    const msgQuery = { chat: chatId, publishedAt: { $exists: true } };
    if (beforeOk) msgQuery.publishedAt = { $lt: before };

    const messages = await Message.find(msgQuery)
      .select("_id sender publishedAt attachment attachments")
      .populate("sender", "name photoUrl status")
      .sort({ publishedAt: -1 })
      .limit(limit);

    const fromMessages = [];
    for (const m of messages) {
      const createdAt = m.publishedAt || m.createdAt;

      const unified = [
        ...(m.attachment ? [m.attachment] : []),
        ...((m.attachments || []) || []),
      ];

      for (const a of unified) {
        if (!a?.url) continue;
        if (!matchesType(a, type)) continue;

        fromMessages.push({
          url: a.url,
          name: a.name,
          mime: a.mime,
          size: a.size,
          createdAt,
          sender: senderDto(m.sender),
          source: { type: "message", id: String(m._id) },
        });
      }
    }

    // 2) Tasks (attachments)
    const taskQuery = { chat: chatId };
    if (beforeOk) taskQuery.createdAt = { $lt: before };

    const tasks = await Task.find(taskQuery)
      .select("_id creator createdAt attachments")
      .populate("creator", "name photoUrl status")
      .sort({ createdAt: -1 })
      .limit(limit);

    const fromTasks = [];
    for (const t of tasks) {
      const createdAt = t.createdAt;

      for (const a of (t.attachments || [])) {
        if (!a?.url) continue;
        if (!matchesType(a, type)) continue;

        fromTasks.push({
          url: a.url,
          name: a.name,
          mime: a.mime,
          size: a.size,
          createdAt,
          sender: senderDto(t.creator),
          source: { type: "task", id: String(t._id) },
        });
      }
    }

    // 3) TaskComments (attachments)
    const commentQuery = { chat: chatId };
    if (beforeOk) commentQuery.createdAt = { $lt: before };

    const comments = await TaskComment.find(commentQuery)
      .select("_id sender createdAt attachments task")
      .populate("sender", "name photoUrl status")
      .sort({ createdAt: -1 })
      .limit(limit);

    const fromComments = [];
    for (const c of comments) {
      const createdAt = c.createdAt;

      for (const a of (c.attachments || [])) {
        if (!a?.url) continue;
        if (!matchesType(a, type)) continue;

        fromComments.push({
          url: a.url,
          name: a.name,
          mime: a.mime,
          size: a.size,
          createdAt,
          sender: senderDto(c.sender),
          source: { type: "comment", id: String(c._id), taskId: String(c.task) },
        });
      }
    }

    // Merge + sort desc by createdAt
    const all = [...fromMessages, ...fromTasks, ...fromComments]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);

    return res.json({ files: all });
  } catch (err) {
    next(err);
  }
});

// ✅ Set / change group photo
router.post("/:chatId/photo", auth, uploadChatPhoto.single("photo"), async (req, res, next) => {
  try {
    const userId = String(req.user.id);
    const { chatId } = req.params;

    const chat = await Chat.findById(chatId).select("_id type members photoUrl");
    if (!chat) return res.status(404).json({ error: "Chat not found" });

    const members = (chat.members || []).map(String);
    if (!members.includes(userId)) return res.status(403).json({ error: "Forbidden" });

    if (String(chat.type).toUpperCase() !== "GROUP") {
      return res.status(400).json({ error: "Only GROUP chats can have a photo" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "Missing file field 'photo'" });
    }

    // borrar foto anterior (best effort)
    if (chat.photoUrl) {
      try {
        const idx = String(chat.photoUrl).indexOf("/uploads/");
        if (idx !== -1) {
          const rel = String(chat.photoUrl).substring(idx); // "/uploads/.."
          const filePath = path.join(process.cwd(), rel);
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
      } catch (_) {}
    }

    // guardar nueva url pública
    const newUrl = `/uploads/chat-photos/${req.file.filename}`;
    chat.photoUrl = newUrl;
    await chat.save();

    return res.json({ ok: true, photoUrl: newUrl });
  } catch (err) {
    next(err);
  }
});

// ===============================
// GROUP: Add members
// PATCH /chats/:chatId/members  { memberIds: ["id1","id2"] }
// ===============================
router.patch("/:chatId/members", auth, async (req, res, next) => {
  try {
    const userId = String(req.user.id);
    const { chatId } = req.params;

    const chat = await Chat.findById(chatId).select("_id type members title photoUrl");
    if (!chat) return res.status(404).json({ error: "Chat not found" });

    if (String(chat.type).toUpperCase() !== "GROUP") {
      return res.status(400).json({ error: "Only GROUP chats can add members" });
    }

    const members = (chat.members || []).map(String);
    if (!members.includes(userId)) return res.status(403).json({ error: "Forbidden" });

    const memberIds = Array.isArray(req.body.memberIds) ? req.body.memberIds : [];
    const clean = memberIds.map(String).filter(Boolean);

    if (clean.length === 0) return res.status(400).json({ error: "memberIds is required" });

    // valida que existan usuarios
    const usersCount = await User.countDocuments({ _id: { $in: clean } });
    if (usersCount !== clean.length) {
      return res.status(400).json({ error: "Some users do not exist" });
    }

    await Chat.findByIdAndUpdate(chatId, {
      $addToSet: { members: { $each: clean } },
    });

    const full = await Chat.findById(chatId)
      .select("_id type title photoUrl members")
      .populate("members", "name email photoUrl status");

    return res.json({
      chat: {
        id: String(full._id),
        type: full.type,
        title: full.title || null,
        photoUrl: full.photoUrl || null,
        members: (full.members || []).map((m) => ({
          _id: String(m._id),
          name: m.name,
          email: m.email,
          photoUrl: m.photoUrl || null,
          status: m.status || "",
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ===============================
// GROUP: Leave group
// POST /chats/:chatId/leave
// ===============================
router.post("/:chatId/leave", auth, async (req, res, next) => {
  try {
    const userId = String(req.user.id);
    const { chatId } = req.params;

    const chat = await Chat.findById(chatId).select("_id type members");
    if (!chat) return res.status(404).json({ error: "Chat not found" });

    if (String(chat.type).toUpperCase() !== "GROUP") {
      return res.status(400).json({ error: "Only GROUP chats can be left" });
    }

    const members = (chat.members || []).map(String);
    if (!members.includes(userId)) return res.status(403).json({ error: "Forbidden" });

    // quitarte del array
    await Chat.findByIdAndUpdate(chatId, { $pull: { members: userId } });

    // opcional: si se queda vacío, borrar chat
    const after = await Chat.findById(chatId).select("_id members");
    if (after && (after.members || []).length === 0) {
      await Chat.findByIdAndDelete(chatId);
      return res.json({ ok: true, deleted: true });
    }

    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ✅ Marcar chat como leído
// POST /chats/:chatId/read
router.post("/:chatId/read", auth, async (req, res, next) => {
  try {
    const userId = String(req.user.id);
    const { chatId } = req.params;

    const chat = await Chat.findById(chatId).select("_id members reads");
    if (!chat) return res.status(404).json({ error: "Chat not found" });

    const members = (chat.members || []).map(String);
    if (!members.includes(userId)) return res.status(403).json({ error: "Forbidden" });

    const now = new Date();

    // si ya existe readState, actualiza; si no, crea uno
    const i = (chat.reads || []).findIndex((r) => String(r.user) === userId);
    if (i >= 0) {
      chat.reads[i].lastReadAt = now;
    } else {
      chat.reads.push({ user: userId, lastReadAt: now });
    }

    await chat.save();

    return res.json({ ok: true, lastReadAt: now });
  } catch (err) {
    next(err);
  }
});

// GET /chats/:chatId/members
router.get("/:chatId/members", auth, async (req, res, next) => {
  try {
    const userId = String(req.user.id);
    const chatId = String(req.params.chatId);

    const chat = await Chat.findById(chatId)
      .select("_id members")
      .populate("members", "name email photoUrl status");

    if (!chat) return res.status(404).json({ error: "Chat not found" });

    const isMember = (chat.members || []).map(m => String(m._id)).includes(userId);
    if (!isMember) return res.status(403).json({ error: "Forbidden" });

    return res.json({
      members: (chat.members || []).map((u) => ({
        id: String(u._id),
        name: u.name || "",
        email: u.email || "",
        photoUrl: u.photoUrl || null,
        status: u.status || "",
      })),
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
