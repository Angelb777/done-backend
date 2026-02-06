const express = require("express");
const { auth } = require("../middleware/auth");
const User = require("../models/User");
const { sendPushToUsers } = require("../utils/push");

const router = express.Router();

// Ver mis tokens guardados
router.get("/my-tokens", auth, async (req, res) => {
  const u = await User.findById(req.user.id).select("email fcmTokens").lean();
  res.json({ email: u?.email, tokens: u?.fcmTokens || [] });
});

// Enviarme una notificación de test
router.post("/push-me", auth, async (req, res) => {
  await sendPushToUsers({
    userIds: [req.user.id],
    title: "DONE TEST",
    body: "Si ves esto, el push funciona.",
    data: { type: "TEST" },
  });
  res.json({ ok: true });
});

module.exports = router;
