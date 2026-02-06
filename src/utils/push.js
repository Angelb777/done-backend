const User = require("../models/User");
const { initFirebaseAdmin } = require("../config/firebase_admin");

// ⚠️ IMPORTANTE: mejor inicializar UNA VEZ, pero si tu init ya controla duplicados, ok.
const firebaseAdmin = initFirebaseAdmin();

async function sendPushToUsers({ userIds, title, body, data = {} }) {
  try {
    const ids = (userIds || []).map(String).filter(Boolean);
    if (!ids.length) return;

    const users = await User.find({ _id: { $in: ids } }).select("fcmTokens").lean();
    const tokens = users.flatMap(u => (u.fcmTokens || [])).filter(Boolean);

    if (!tokens.length) {
      console.log("📭 PUSH: no tokens for userIds:", ids);
      return;
    }

    const payload = {
      tokens,
      notification: {
        title: String(title || "DONE"),
        body: String(body || ""),
      },
      data: Object.fromEntries(
        Object.entries({
          ...data,
          click_action: "FLUTTER_NOTIFICATION_CLICK",
        }).map(([k, v]) => [String(k), String(v ?? "")])
      ),
      android: {
        priority: "high",
        notification: {
          channelId: "messages",
        },
      },
    };

    const res = await firebaseAdmin.messaging().sendEachForMulticast(payload);

    console.log(
      `🔔 PUSH: tokens=${tokens.length} success=${res.successCount} fail=${res.failureCount}`
    );

    // Limpia tokens inválidos
    if (res.failureCount > 0) {
      const bad = [];
      res.responses.forEach((r, i) => {
        if (!r.success) {
          const code = r.error?.code || "unknown";
          console.log("❌ PUSH error:", code, "token:", tokens[i]);
          bad.push(tokens[i]);
        }
      });

      if (bad.length) {
        await User.updateMany(
          { fcmTokens: { $in: bad } },
          { $pull: { fcmTokens: { $in: bad } } }
        );
        console.log("🧹 Removed bad tokens:", bad.length);
      }
    }
  } catch (e) {
    console.log("🔥 PUSH send failed:", e?.message || e);
  }
}

module.exports = { sendPushToUsers };
