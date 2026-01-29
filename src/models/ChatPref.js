// models/ChatPref.js
const mongoose = require("mongoose");

const ChatPrefSchema = new mongoose.Schema(
  {
    chat: { type: mongoose.Schema.Types.ObjectId, ref: "Chat", required: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    color: { type: String, default: "white" }, // "white" = sin color
  },
  { timestamps: true }
);

// 1 preferencia por (chat,user)
ChatPrefSchema.index({ chat: 1, user: 1 }, { unique: true });

module.exports = mongoose.model("ChatPref", ChatPrefSchema);
