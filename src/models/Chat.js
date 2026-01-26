// src/models/Chat.js
const mongoose = require("mongoose");

const chatSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["DM", "GROUP", "PERSONAL"], required: true },
    title: { type: String },
    photoUrl: { type: String },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: "User", index: true }],
    lastMessageAt: { type: Date },
    lastMessagePreview: { type: String },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Chat", chatSchema);
