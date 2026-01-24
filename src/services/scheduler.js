const Message = require("../models/Message");
const Chat = require("../models/Chat");
const Task = require("../models/Task");
const { TASK_STATUS } = require("../utils/constants");

let timer = null;

async function tick() {
  const now = new Date();

  // 1) Publish scheduled messages due to publish
  const due = await Message.find({
    isScheduled: true,
    publishedAt: { $exists: false },
    scheduledFor: { $lte: now }
  })
    .limit(50)
    .sort({ scheduledFor: 1 });

  for (const msg of due) {
    msg.isScheduled = false;
    msg.publishedAt = new Date();
    await msg.save();

    // Update chat preview
    const preview = msg.type === "TASK" ? `🧩 ${msg.text || "Tarea"}` : (msg.text || "Mensaje");
    await Chat.updateOne(
      { _id: msg.chat },
      { $set: { lastMessageAt: msg.publishedAt, lastMessagePreview: preview } }
    );
  }

  // 2) Auto-archivar tareas DONE con más de 24h completadas
  await archiveOldDoneTasks(now);
}

async function archiveOldDoneTasks(now = new Date()) {
  const limit = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  await Task.updateMany(
    {
      status: TASK_STATUS.DONE,
      archivedAt: null,
      completedAt: { $exists: true, $ne: null, $lte: limit }
    },
    { $set: { archivedAt: now } }
  );
}

function startScheduler() {
  const interval = Number(process.env.SCHEDULER_INTERVAL_MS || 2000);

  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    tick().catch((err) => console.error("Scheduler error:", err));
  }, interval);

  console.log(`Scheduler started (interval ${interval}ms)`);
}

module.exports = { startScheduler };
