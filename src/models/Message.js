const mongoose = require("mongoose");
const { MESSAGE_TYPES } = require("../utils/constants");

const attachmentSchema = new mongoose.Schema(
  {
    url: { type: String, required: true }, // "/uploads/xxx" o url absoluta
    name: { type: String, required: true }, // "factura.pdf"
    mime: { type: String, required: true }, // "application/pdf" | "image/jpeg"
    size: { type: Number, required: true }, // bytes
  },
  { _id: false }
);

const messageSchema = new mongoose.Schema(
  {
    chat: { type: mongoose.Schema.Types.ObjectId, ref: "Chat", required: true, index: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    // ✅ NORMAL / TASK / IMAGE / FILE (según tus constants)
    type: { type: String, enum: Object.values(MESSAGE_TYPES), required: true },

    text: { type: String },

    // legacy
    imageUrl: { type: String },

    // ✅ Compat: 1 adjunto (legacy)
    attachment: { type: attachmentSchema, default: null },

    // ✅ NUEVO: múltiples adjuntos (para mensajes / y útil a futuro)
    attachments: { type: [attachmentSchema], default: [] },

    // Scheduling
    isScheduled: { type: Boolean, default: false, index: true },
    scheduledFor: { type: Date, index: true },
    publishedAt: { type: Date, index: true },

    // Link a Task (mensaje tipo TASK)
    task: { type: mongoose.Schema.Types.ObjectId, ref: "Task", default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Message", messageSchema);
