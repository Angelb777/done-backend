const express = require("express");
const router = express.Router();

const User = require("../models/User");
const Chat = require("../models/Chat");
const { auth } = require("../middleware/auth");

// POST /dev/seed
router.post("/seed", auth, async (req, res, next) => {
  try {
    const myId = req.user?.id || req.user?._id || req.userId;
    if (!myId) return res.status(401).json({ error: "Not authenticated" });

    // Usuario bot
    let bot = await User.findOne({ email: "bot@done.test" });
    if (!bot) {
      bot = await User.create({
        name: "DONE Bot",
        email: "bot@done.test",
        password: "123456",
      });
    }

    // Chat DM
    let chat = await Chat.findOne({
      type: "DM",
      members: { $all: [myId, bot._id] },
    });

    if (!chat) {
      chat = await Chat.create({
        type: "DM",
        title: "Test DONE",
        members: [myId, bot._id],
      });
    }

    res.json({
      chat: {
        id: chat._id.toString(),
        title: chat.title,
        type: chat.type,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
