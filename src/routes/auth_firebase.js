// src/routes/auth_firebase.js
const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");

// ✅ Firebase Admin (init por env var)
const { initFirebaseAdmin } = require("../config/firebase_admin");
const firebaseAdmin = initFirebaseAdmin();

// ✅ Tu modelo de usuario
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

    const firebaseUid = decoded.uid || "";
    const email = (decoded.email || "").toLowerCase().trim();
    const name = decoded.name || decoded.displayName || "Usuario";
    const photoUrl = decoded.picture || "";

    if (!email) {
      return res.status(400).json({ error: "No email in Firebase token" });
    }

    // 2) Buscar/crear usuario en BD
    let user = await User.findOne({ email });

    if (!user) {
      user = await User.create({
        email,
        name,
        photoUrl,
        authProvider: "google",
        firebaseUid,
        // passwordHash NO hace falta, tu schema ya lo permite (default "")
      });
    } else {
      // Asegura provider y firebaseUid (por si existía de antes)
      let changed = false;

      if (user.authProvider !== "google") {
        user.authProvider = "google";
        changed = true;
      }

      if (!user.firebaseUid && firebaseUid) {
        user.firebaseUid = firebaseUid;
        changed = true;
      }

      if ((!user.name || user.name === "Usuario") && name && name !== "Usuario") {
        user.name = name;
        changed = true;
      }

      if ((!user.photoUrl || user.photoUrl === "") && photoUrl) {
        user.photoUrl = photoUrl;
        changed = true;
      }

      if (changed) await user.save();
    }

    // 3) Firmar TU JWT
    const uid = user._id.toString();

const token = signToken({
  sub: uid,        // ✅ CLAVE: tu middleware usa payload.sub
  id: uid,         // (opcional) compat
  userId: uid,     // (opcional) compat
  role: user.role,
});



    return res.json({ token });
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);

    // 👇 Esto te da la pista REAL en Render logs
    console.log("🔥 /auth/firebase FAILED:", msg);

    // 401 solo para fallos típicos de verifyIdToken
    const isAuthError =
      msg.includes("Firebase ID token") ||
      msg.includes("auth/") ||
      msg.includes("verifyIdToken") ||
      msg.includes("token") ||
      msg.includes("audience") ||
      msg.includes("expired");

    return res.status(isAuthError ? 401 : 500).json({
      error: isAuthError ? "Invalid token" : "Server error",
      details: msg,
    });
  }
});

module.exports = router;
