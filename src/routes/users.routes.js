const express = require("express");
const User = require("../models/User");
const { auth } = require("../middleware/auth");

const router = express.Router();

/**
 * GET /users/search?q=texto
 * Buscar usuarios por email o nombre (para crear DM)
 */
router.get("/search", auth, async (req, res, next) => {
  try {
    const me = req.user.id;
    const q = String(req.query.q || "").trim();

    // Evitamos búsquedas inútiles
    if (q.length < 2) {
      return res.json({ users: [] });
    }

    const users = await User.find({
      _id: { $ne: me }, // no devolverte a ti mismo
      $or: [
        { email: { $regex: q, $options: "i" } },
        { name: { $regex: q, $options: "i" } }
      ]
    })
      .limit(20)
      .select("_id email name photoUrl");

    return res.json({
      users: users.map((u) => ({
        id: u._id,
        email: u.email,
        name: u.name,
        photoUrl: u.photoUrl || null
      }))
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
