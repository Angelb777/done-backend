const admin = require("firebase-admin");

/**
 * Inicializa Firebase Admin de forma segura:
 * - En local: puedes usar un JSON por ruta (FIREBASE_ADMIN_CRED_PATH)
 * - En Render/producción: usa FIREBASE_ADMIN_CRED_JSON (string JSON)
 */

function initFirebaseAdmin() {
  if (admin.apps.length) return admin;

  // ✅ 1) Preferido: JSON en variable de entorno (Render)
  const raw = process.env.FIREBASE_ADMIN_CRED_JSON;
  if (raw && raw.trim()) {
    const serviceAccount = JSON.parse(raw);

    // 🔥 Importante: la private_key suele venir con \n escapados
    if (serviceAccount.private_key && typeof serviceAccount.private_key === "string") {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");
    }

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });

    return admin;
  }

  // ✅ 2) Opcional: ruta a fichero JSON (solo local, si quieres)
  const p = process.env.FIREBASE_ADMIN_CRED_PATH;
  if (p && p.trim()) {
    // eslint-disable-next-line import/no-dynamic-require, global-require
    const serviceAccount = require(p);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    return admin;
  }

  throw new Error(
    "Firebase Admin not configured. Set FIREBASE_ADMIN_CRED_JSON (recommended) or FIREBASE_ADMIN_CRED_PATH"
  );
}

module.exports = { admin, initFirebaseAdmin };
