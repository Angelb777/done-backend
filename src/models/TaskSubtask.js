const mongoose = require("mongoose");
const { TASK_COLORS } = require("../utils/constants");

const attachmentSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    name: { type: String, required: true },
    mime: { type: String, required: true },
    size: { type: Number, required: true },
    // opcional: para poder distinguir que viene de subtarea cuando lo copies a Task
    source: {
      type: { type: String, default: "SUBTASK" }, // "SUBTASK"
      subtaskId: { type: String, default: null },
    },
  },
  { _id: false }
);

const taskSubtaskSchema = new mongoose.Schema(
  {
    task: { type: mongoose.Schema.Types.ObjectId, ref: "Task", required: true, index: true },
    chat: { type: mongoose.Schema.Types.ObjectId, ref: "Chat", required: true, index: true },
    creator: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    text: { type: String, required: true, trim: true },

    done: { type: Boolean, default: false },
    doneAt: { type: Date, default: null },

    // ✅ NUEVO: color subtarea
    color: { type: String, default: "gray", enum: TASK_COLORS },

    // ✅ NUEVO: orden persistente
    order: { type: Number, default: 0, index: true },

    // ✅ NUEVO: adjuntos subtarea
    attachments: { type: [attachmentSchema], default: [] },
  },
  { timestamps: true }
);

// ✅ Ordena siempre por order
taskSubtaskSchema.index({ task: 1, order: 1 });

module.exports = mongoose.model("TaskSubtask", taskSubtaskSchema);
