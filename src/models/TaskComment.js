const mongoose = require("mongoose");

const attachmentSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    name: { type: String, required: true },
    mime: { type: String, required: true },
    size: { type: Number, required: true },
  },
  { _id: false }
);

const taskCommentSchema = new mongoose.Schema(
  {
    task: { type: mongoose.Schema.Types.ObjectId, ref: "Task", required: true, index: true },
    chat: { type: mongoose.Schema.Types.ObjectId, ref: "Chat", required: true, index: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    text: { type: String, default: "" },
    attachments: { type: [attachmentSchema], default: [] },
  },
  { timestamps: true }
);

taskCommentSchema.index({ task: 1, createdAt: -1 });
taskCommentSchema.index({ chat: 1, createdAt: -1 });

module.exports = mongoose.model("TaskComment", taskCommentSchema);
