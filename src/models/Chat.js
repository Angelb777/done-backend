// src/models/Chat.js
const mongoose = require("mongoose");

const chatReadSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    lastReadAt: { type: Date, default: new Date(0) },
  },
  { _id: false }
);

const chatSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["DM", "GROUP", "PERSONAL"], required: true },
    title: { type: String },
    photoUrl: { type: String },

    // ✅ lo dejamos igual para no romper nada
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: "User", index: true }],

    // ✅ NUEVO: estado de lectura por usuario
    reads: { type: [chatReadSchema], default: [] },

    lastMessageAt: { type: Date },
    lastMessagePreview: { type: String },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Chat", chatSchema);
