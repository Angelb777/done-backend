// src/routes/auth_firebase.js
const express = require("express");
const router = express.Router();

// ✅ Firebase Admin (nuevo init por env var)
const { initFirebaseAdmin } = require("../config/firebase_admin");
const firebaseAdmin = initFirebaseAdmin();

// ✅ AJUSTA ESTAS 2 IMPORTACIONES A TU PROYECTO REAL
const User = require("../models/User");      // <-- cambia si tu modelo está en otro path
const { signJwt } = require("../utils/jwt"); // <-- cambia si tu función JWT está en otro path

router.post("/auth/firebase", async (req, res) => {
  try {
    const { idToken } = req.body || {};
    if (!idToken) return res.status(400).json({ error: "Missing idToken" });

    // 1) Verificar token de Google/Firebase
    const decoded = await firebaseAdmin.auth().verifyIdToken(idToken);

    const email = (decoded.email || "").toLowerCase().trim();
    const name = decoded.name || decoded.displayName || "Usuario";

    if (!email) {
      return res.status(400).json({ error: "No email in Firebase token" });
    }

    // 2) Buscar/crear usuario en tu BD
    let user = await User.findOne({ email });

    if (!user) {
      user = await User.create({
        name,
        email,
        authProvider: "google",
      });
    } else {
      // Opcional: si el usuario ya existe sin provider, lo marcamos
      if (!user.authProvider) {
        user.authProvider = "google";
        await user.save();
      }
      // Opcional: si estaba sin nombre
      if ((!user.name || user.name === "Usuario") && name && name !== "Usuario") {
        user.name = name;
        await user.save();
      }
    }

    // 3) Crear TU JWT (igual que en /auth/login)
    const token = signJwt({ userId: user._id.toString() });

    return res.json({ token });
  } catch (e) {
    return res.status(401).json({
      error: "Invalid Firebase token",
      details: String(e && e.message ? e.message : e),
    });
  }
});

module.exports = router;
