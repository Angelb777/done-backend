const path = require("path");
const fs = require("fs");
const multer = require("multer");

const UPLOAD_DIR = path.join(__dirname, "..", "..", "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "");
    const base = path
      .basename(file.originalname || "file", ext)
      .replace(/[^a-zA-Z0-9-_]/g, "_")
      .slice(0, 80);

    const unique = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    cb(null, `${unique}_${base}${ext}`);
  },
});

function fileFilter(req, file, cb) {
  // MVP: aceptamos casi todo. Puedes restringir si quieres.
  cb(null, true);
}

const upload = multer({
  storage,
  fileFilter,
  limits: {
    files: 10,
    fileSize: 50 * 1024 * 1024, // 50MB por archivo (ajusta)
  },
});

// ✅ IMPORTANTE: devolvemos path relativo SIEMPRE.
// Así:
// - Web lo abre con location.origin + path
// - Flutter lo abre con AppConfig.baseUrl + path
function toPublicUrl(req, filename) {
  return `/uploads/${encodeURIComponent(filename)}`;
}

module.exports = { upload, toPublicUrl, UPLOAD_DIR };
