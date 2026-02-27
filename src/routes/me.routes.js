// routes/me.routes.js
const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const User = require("../models/User");
const { auth } = require("../middleware/auth"); // 👈 CLAVE

const router = express.Router();

console.log("✅ me.routes loaded");

// ===============================
// Helpers
// ===============================
function safeSection(s) {
  const section = String(s || "");
  if (!["pending", "requested"].includes(section)) return null;
  return section;
}

// ---------- Multer setup ----------
const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const safeExt = [".jpg", ".jpeg", ".png", ".webp"].includes(ext) ? ext : ".jpg";
    cb(null, `user_${req.user.id}_${Date.now()}${safeExt}`);
  },
});

const fileFilter = (req, file, cb) => {
  // Acepta JPEG/PNG/WEBP + HEIC/HEIF (muy común en móvil)
  const ok =
    file.mimetype.startsWith("image/") ||
    ["image/heic", "image/heif", "application/octet-stream"].includes(file.mimetype);

  cb(ok ? null : new Error("Formato de imagen no permitido"), ok);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
});

// ---------- GET /me ----------
router.get("/", auth, async (req, res, next) => {
  try {
    const userId = req.user.id;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    const pub = user.toPublic();

    // ✅ override admin por .env
    const adminList = (process.env.ADMIN_EMAILS || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    if (adminList.includes(String(pub.email || "").toLowerCase())) pub.role = "admin";

    return res.json({ user: pub });
  } catch (err) {
    next(err);
  }
});

// ---------- PATCH /me ----------
router.patch("/", auth, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { name, status } = req.body;

    const updates = {};
    if (typeof name === "string") updates.name = name.trim().slice(0, 50);
    if (typeof status === "string") updates.status = status.trim().slice(0, 80);

    const user = await User.findByIdAndUpdate(userId, updates, { new: true });
    if (!user) return res.status(404).json({ error: "User not found" });

    return res.json({ user: user.toPublic() });
  } catch (err) {
    next(err);
  }
});

// ---------- POST /me/photo ----------
router.post("/photo", auth, upload.single("photo"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const userId = req.user.id;
    const photoUrl = `/uploads/${req.file.filename}`;

    const user = await User.findByIdAndUpdate(userId, { photoUrl }, { new: true });
    if (!user) return res.status(404).json({ error: "User not found" });

    return res.json({ user: user.toPublic() });
  } catch (err) {
    next(err);
  }
});

// ===============================
// ✅ TASK ORDER (ya lo tenías)
// ===============================
router.get("/task-order", auth, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select("taskOrder");
    return res.json({ taskOrder: user?.taskOrder || { pending: [], requested: [] } });
  } catch (e) {
    next(e);
  }
});

router.patch("/task-order", auth, async (req, res, next) => {
  try {
    const section = safeSection(req.body.section);
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(String) : [];

    if (!section) return res.status(400).json({ error: "Invalid section" });

    const updated = await User.findByIdAndUpdate(
      req.user.id,
      { $set: { [`taskOrder.${section}`]: ids } },
      { new: true, select: "taskOrder" }
    );

    return res.json({ ok: true, taskOrder: updated?.taskOrder || { pending: [], requested: [] } });
  } catch (e) {
    next(e);
  }
});

// ===============================
// ✅ TASK GROUPS (NUEVO) — FIXED
// ===============================

// GET /me/task-groups
router.get("/task-groups", auth, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select("taskGroups");
    return res.json({
      taskGroups: user?.taskGroups || { pending: [], requested: [] },
    });
  } catch (e) {
    next(e);
  }
});

// PATCH /me/task-groups
// body: { section: "pending"|"requested", groups: [{ id, title, taskIds }] }
router.patch("/task-groups", auth, async (req, res, next) => {
  try {
    const section = safeSection(req.body.section);
    const groups = Array.isArray(req.body.groups) ? req.body.groups : null;

    if (!section) return res.status(400).json({ error: "Invalid section" });
    if (!groups) return res.status(400).json({ error: "groups required" });

    // ✅ IMPORTANTES:
    // - usamos `title` (no `name`) para que case con Flutter (group.title)
    // - nunca guardamos carpetas con <2 tareas
    // - dedupe de taskIds por seguridad
    const clean = groups
      .map((g) => {
        const id = String(g?.id || "").trim();
        const title = String(g?.title || "").trim().slice(0, 40);

        const rawIds = Array.isArray(g?.taskIds) ? g.taskIds : [];
        const taskIds = [...new Set(rawIds.map(String).map((s) => s.trim()).filter(Boolean))];

        return { id, title, taskIds };
      })
      .filter((g) => g.id && g.title && Array.isArray(g.taskIds));

    const updated = await User.findByIdAndUpdate(
      req.user.id,
      { $set: { [`taskGroups.${section}`]: clean } },
      { new: true, select: "taskGroups" }
    );

    return res.json({
      ok: true,
      taskGroups: updated?.taskGroups || { pending: [], requested: [] },
    });
  } catch (e) {
    next(e);
  }
});

// ✅ POST /me/push-token  body: { token: "FCM_TOKEN" }
router.post("/push-token", auth, async (req, res, next) => {
  try {
    const token = String(req.body?.token || "").trim();
    if (!token) return res.status(400).json({ error: "Missing token" });

    await User.updateOne({ _id: req.user.id }, { $addToSet: { fcmTokens: token } }); // no duplica
    return res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;