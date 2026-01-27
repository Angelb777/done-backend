const mongoose = require("mongoose");

const taskSubtaskSchema = new mongoose.Schema(
  {
    task: { type: mongoose.Schema.Types.ObjectId, ref: "Task", required: true, index: true },
    chat: { type: mongoose.Schema.Types.ObjectId, ref: "Chat", required: true, index: true },
    creator: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    text: { type: String, required: true, trim: true },
    done: { type: Boolean, default: false },
    doneAt: { type: Date, default: null },
  },
  { timestamps: true }
);

taskSubtaskSchema.index({ task: 1, createdAt: 1 });

module.exports = mongoose.model("TaskSubtask", taskSubtaskSchema);
