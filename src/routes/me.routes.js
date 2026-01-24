const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const User = require("../models/User");
const { auth } = require("../middleware/auth"); // 👈 CLAVE

const router = express.Router();

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

    if (adminList.includes(pub.email.toLowerCase())) pub.role = "admin";

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

    const user = await User.findByIdAndUpdate(
      userId,
      { photoUrl },
      { new: true }
    );

    return res.json({ user: user.toPublic() });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
