const mongoose = require("mongoose");
const { TASK_STATUS, TASK_COLORS } = require("../utils/constants");

const attachmentSchema = new mongoose.Schema(
  {
    url: { type: String, required: true }, // "/uploads/xxx" o url absoluta
    name: { type: String, required: true }, // "factura.pdf"
    mime: { type: String, required: true }, // "application/pdf" | "image/jpeg"
    size: { type: Number, required: true }, // bytes
  },
  { _id: false }
);

const taskSchema = new mongoose.Schema(
  {
    chat: { type: mongoose.Schema.Types.ObjectId, ref: "Chat", required: true, index: true },
    message: { type: mongoose.Schema.Types.ObjectId, ref: "Message", required: true, unique: true },
    creator: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    title: { type: String, required: true },
    color: { type: String, enum: TASK_COLORS, default: "gray" },

    // ✅ NUEVO: múltiples responsables
    assignees: [{ type: mongoose.Schema.Types.ObjectId, ref: "User", index: true, default: [] }],

    // ✅ Mantengo el campo antiguo como "principal" (para compatibilidad)
    assignee: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    dueDate: { type: Date },

    status: {
      type: String,
      enum: [TASK_STATUS.PENDING, TASK_STATUS.DONE],
      default: TASK_STATUS.PENDING,
      index: true,
    },

    completionNote: { type: String },
    completionImageUrl: { type: String },
    completedAt: { type: Date, index: true },

    // ✅ Adjuntos en la tarea (fotos/docs)
    attachments: { type: [attachmentSchema], default: [] },

    // ✅ “Historial” = archivada (manual o auto tras 24h)
    archivedAt: { type: Date, index: true },
    archivedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, // opcional
  },
  { timestamps: true }
);

// ✅ Mantener assignee <-> assignees sincronizados
taskSchema.pre("validate", function () {
  // si llega assignee pero no assignees, lo meto en lista
  if ((!this.assignees || this.assignees.length === 0) && this.assignee) {
    this.assignees = [this.assignee];
  }

  // si llega assignees pero no assignee, uso el primero como "principal"
  if (!this.assignee && this.assignees && this.assignees.length > 0) {
    this.assignee = this.assignees[0];
  }
});

module.exports = mongoose.model("Task", taskSchema);
