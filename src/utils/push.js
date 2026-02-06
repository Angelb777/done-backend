const User = require("../models/User");
const { initFirebaseAdmin } = require("../config/firebase_admin");

const firebaseAdmin = initFirebaseAdmin();

async function sendPushToUsers({ userIds, title, body, data = {} }) {
  const ids = (userIds || []).map(String);
  if (!ids.length) return;

  const users = await User.find({ _id: { $in: ids } }).select("fcmTokens");
  const tokens = users.flatMap(u => (u.fcmTokens || [])).filter(Boolean);

  if (!tokens.length) return;

  await firebaseAdmin.messaging().sendEachForMulticast({
    tokens,
    notification: { title, body },
    data: Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, String(v)])
    ),
    android: {
      priority: "high",
      notification: { channelId: "messages" }, // 👈 mismo channelId que Flutter
    },
  });
}

module.exports = { sendPushToUsers };
