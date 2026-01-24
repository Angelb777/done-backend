const User = require("../models/User");
const { verifyToken } = require("../utils/jwt");

function isAdminEmail(email) {
  const list = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  if (!email) return false;
  return list.includes(email.toLowerCase());
}

async function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const [type, token] = header.split(" ");

  if (type !== "Bearer" || !token) {
    return res.status(401).json({ error: "Missing or invalid Authorization header" });
  }

  try {
    const payload = verifyToken(token);

    const user = await User.findById(payload.sub);
    if (!user) return res.status(401).json({ error: "Invalid token" });

    // ✅ Mantener compatibilidad con tu código actual: req.user.id
    // ✅ Añadimos role + email (para admin panel)
    const role = isAdminEmail(user.email) ? "admin" : (user.role || "user");

    req.user = {
      id: String(user._id),
      email: user.email,
      name: user.name,
      role,
    };

    return next();
  } catch (e) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

module.exports = { auth };
