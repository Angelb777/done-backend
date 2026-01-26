const express = require("express");
const { auth } = require("../middleware/auth");
const User = require("../models/User");

const router = express.Router();

/**
 * GET /me/task-order
 */
router.get("/me/task-order", auth, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select("taskOrder");
    return res.json({ taskOrder: user?.taskOrder || { pending: [], requested: [] } });
  } catch (e) {
    next(e);
  }
});

/**
 * PATCH /me/task-order
 * body: { section: "pending"|"requested", ids: string[] }
 */
router.patch("/me/task-order", auth, async (req, res, next) => {
  try {
    const section = String(req.body.section || "");
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(String) : [];

    if (!["pending", "requested"].includes(section)) {
      return res.status(400).json({ error: "Invalid section" });
    }

    await User.findByIdAndUpdate(
      req.user.id,
      { $set: { [`taskOrder.${section}`]: ids } },
      { new: true }
    );

    return res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
