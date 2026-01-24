const express = require("express");
const User = require("../models/User");
const { hashPassword, comparePassword } = require("../utils/hash");
const { signToken } = require("../utils/jwt");
const { registerSchema, loginSchema } = require("../utils/validators");

const router = express.Router();

function isAdminEmail(email) {
  const list = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  if (!email) return false;
  return list.includes(email.toLowerCase());
}

router.post("/register", async (req, res, next) => {
  try {
    const data = registerSchema.parse(req.body);

    const exists = await User.findOne({ email: data.email.toLowerCase() });
    if (exists) return res.status(409).json({ error: "Email already in use" });

    const passwordHash = await hashPassword(data.password);

    const user = await User.create({
      email: data.email.toLowerCase(),
      passwordHash,
      name: data.name,
    });

    const token = signToken(user._id);

    const pub = user.toPublic();
    if (isAdminEmail(pub.email)) pub.role = "admin";

    return res.json({ token, user: pub });
  } catch (err) {
    return next(err);
  }
});

router.post("/login", async (req, res, next) => {
  try {
    const data = loginSchema.parse(req.body);

    const user = await User.findOne({ email: data.email.toLowerCase() });
    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    const ok = await comparePassword(data.password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    const token = signToken(user._id);

    const pub = user.toPublic();
    if (isAdminEmail(pub.email)) pub.role = "admin";

    return res.json({ token, user: pub });
  } catch (err) {
    return next(err);
  }
});

router.post("/forgot-password", async (req, res) => {
  return res.json({ ok: true, note: "MVP placeholder. Implement email reset later." });
});

module.exports = router;
