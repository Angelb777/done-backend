const MESSAGE_TYPES = {
  NORMAL: "NORMAL",
  TASK: "TASK",
  IMAGE: "IMAGE",
  FILE: "FILE",
};

const TASK_STATUS = {
  PENDING: "PENDING",
  DONE: "DONE",
};

const TASK_COLORS = [
  "gray",
  "yellow",
  "orange",
  "red",
  "pink",
  "purple",
  "blue",
  "teal",
  "green",
  "brown",
];

// ✅ NUEVO: colores permitidos para chats (incluye "white")
const CHAT_COLORS = ["white", ...TASK_COLORS];

module.exports = {
  MESSAGE_TYPES,
  TASK_STATUS,
  TASK_COLORS,
  CHAT_COLORS, // ✅ EXPORTAR
};
