// src/routes/auth_firebase.js
const express = require('express');
const router = express.Router();
const admin = require('../config/firebase_admin');

// TODO: ajusta estas importaciones a tu proyecto real
// Si ya tienes un user model y una función para firmar JWT, usa las tuyas.
const User = require('../models/User');           // <-- cámbialo si tu ruta/modelo es otro
const { signJwt } = require('../utils/jwt');      // <-- cámbialo si tu jwt está en otro sitio

router.post('/auth/firebase', async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ error: 'Missing idToken' });

    // 1) Verificar token de Google/Firebase
    const decoded = await admin.auth().verifyIdToken(idToken);

    const email = (decoded.email || '').toLowerCase().trim();
    const name = decoded.name || 'Usuario';
    if (!email) return res.status(400).json({ error: 'No email in Firebase token' });

    // 2) Buscar/crear usuario en tu BD
    let user = await User.findOne({ email });
    if (!user) {
      user = await User.create({
        name,
        email,
        // NO password (viene de Google)
        authProvider: 'google',
      });
    }

    // 3) Crear TU JWT (igual que en /auth/login)
    const token = signJwt({ userId: user._id.toString() });

    return res.json({ token });
  } catch (e) {
    return res.status(401).json({ error: 'Invalid Firebase token', details: String(e) });
  }
});

module.exports = router;
