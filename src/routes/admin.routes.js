const express = require("express");
const router = express.Router();

const { auth } = require("../middleware/auth");
const { requireAdmin } = require("../middleware/requireAdmin");

const User = require("../models/User");
const Chat = require("../models/Chat");
const Message = require("../models/Message");
const Task = require("../models/Task");

// todo lo de /admin requiere login + admin
router.use(auth, requireAdmin);

// GET /admin/stats
router.get("/stats", async (req, res, next) => {
  try {
    const [users, chats, messages, tasks] = await Promise.all([
      User.countDocuments({}),
      Chat.countDocuments({}),
      Message.countDocuments({}),
      Task.countDocuments({}),
    ]);

    return res.json({ users, chats, messages, tasks });
  } catch (e) {
    next(e);
  }
});

// GET /admin/users?q=
router.get("/users", async (req, res, next) => {
  try {
    const q = (req.query.q || "").trim();
    const filter = q
      ? {
          $or: [
            { email: { $regex: q, $options: "i" } },
            { name: { $regex: q, $options: "i" } },
          ],
        }
      : {};

    const users = await User.find(filter).sort({ createdAt: -1 }).limit(200);
    return res.json(users.map((u) => u.toPublic()));
  } catch (e) {
    next(e);
  }
});

// PATCH /admin/users/:id/role  body: { role: "admin" | "user" }
router.patch("/users/:id/role", async (req, res, next) => {
  try {
    const { role } = req.body;
    if (!["admin", "user"].includes(role)) {
      return res.status(400).json({ error: "Invalid role" });
    }

    const u = await User.findByIdAndUpdate(req.params.id, { role }, { new: true });
    if (!u) return res.status(404).json({ error: "User not found" });

    return res.json(u.toPublic());
  } catch (e) {
    next(e);
  }
});

module.exports = router;
