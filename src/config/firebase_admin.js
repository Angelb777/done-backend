// src/config/firebase_admin.js
const admin = require('firebase-admin');

// ✅ pon aquí tu ruta real al JSON de service account
// Ej: ./src/config/done-b8360-firebase-adminsdk-xxxx.json
const serviceAccount = require('./done-b8360-firebase-adminsdk-XXXX.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

module.exports = admin;
