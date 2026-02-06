// src/routes/auth_firebase.js
const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");

// ✅ Firebase Admin (init por env var)
const { initFirebaseAdmin } = require("../config/firebase_admin");
const firebaseAdmin = initFirebaseAdmin();

// ✅ Tu modelo de usuario (ajusta SOLO si tu archivo se llama distinto)
const User = require("../models/User");

function signToken(payload) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("Missing JWT_SECRET env var");

  const expiresIn = process.env.JWT_EXPIRES_IN || "30d";
  return jwt.sign(payload, secret, { expiresIn });
}

router.post("/auth/firebase", async (req, res) => {
  try {
    const { idToken } = req.body || {};
    if (!idToken) return res.status(400).json({ error: "Missing idToken" });

    // 1) Verificar token Firebase
    const decoded = await firebaseAdmin.auth().verifyIdToken(idToken);

    const email = (decoded.email || "").toLowerCase().trim();
    const name = decoded.name || decoded.displayName || "Usuario";

    if (!email) return res.status(400).json({ error: "No email in Firebase token" });

    // 2) Buscar/crear usuario en BD (SIN password)
    let user = await User.findOne({ email });

    if (!user) {
      user = await User.create({
        email,
        name,
        authProvider: "google", // si no tienes este campo en el schema, bórralo
        passwordHash: "",       // por si tu schema lo tiene
      });
    } else {
      // Si quieres actualizar nombre/foto si vienen de Google (opcional)
      if (!user.name || user.name === "Usuario") {
        user.name = name;
        await user.save();
      }
    }

    // 3) Firmar TU JWT
    const token = signToken({ userId: user._id.toString() });

    return res.json({ token });
  } catch (e) {
    // Si falla verifyIdToken => 401. Si falla otra cosa => 500.
    const msg = String(e && e.message ? e.message : e);
    const isAuthError =
      msg.includes("Firebase ID token") ||
      msg.includes("auth/") ||
      msg.includes("verifyIdToken");

    return res.status(isAuthError ? 401 : 500).json({
      error: isAuthError ? "Invalid Firebase token" : "Server error",
      details: msg,
    });
  }
});

module.exports = router;
