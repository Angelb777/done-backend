// models/TaskSubtask.js
const mongoose = require("mongoose");
const { TASK_COLORS } = require("../utils/constants");

const attachmentSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    name: { type: String, required: true },
    mime: { type: String, required: true },
    size: { type: Number, required: true },

    // opcional: para distinguir que viene de subtarea cuando lo copies a Task
    source: {
      type: { type: String, default: "SUBTASK" }, // "SUBTASK"
      subtaskId: { type: String, default: null },
    },
  },
  { _id: false }
);

const taskSubtaskSchema = new mongoose.Schema(
  {
    task: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Task",
      required: true,
      index: true,
    },
    chat: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Chat",
      required: true,
      index: true,
    },
    creator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // ✅ NUEVO: tipo de nodo (ITEM normal o FOLDER carpeta)
    type: {
      type: String,
      enum: ["ITEM", "FOLDER"],
      default: "ITEM",
      index: true,
    },

    // ✅ NUEVO: parentId (null => root, folderId => dentro de esa carpeta)
    parentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TaskSubtask",
      default: null,
      index: true,
    },

    // ✅ IMPORTANTE: mantenemos text required para compatibilidad.
    // Para FOLDER, en routes lo setearás a "__FOLDER__" (o similar).
    text: { type: String, required: true, trim: true },

    done: { type: Boolean, default: false },
    doneAt: { type: Date, default: null },

    // ✅ NUEVO: color subtarea / carpeta
    color: { type: String, default: "gray", enum: TASK_COLORS },

    // ✅ NUEVO: orden persistente (por parentId)
    order: { type: Number, default: 0, index: true },

    // ✅ NUEVO: adjuntos subtarea
    attachments: { type: [attachmentSchema], default: [] },

    // ✅ NUEVO: campos de carpeta
    // (solo aplican si type === "FOLDER")
    title: { type: String, default: "" },
    collapsed: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// ✅ Índice clave: orden por parent (root o dentro de carpeta)
taskSubtaskSchema.index({ task: 1, parentId: 1, order: 1 });

// (opcional) si quieres mantener el antiguo también, no molesta:
// taskSubtaskSchema.index({ task: 1, order: 1 });

module.exports = mongoose.model("TaskSubtask", taskSubtaskSchema);