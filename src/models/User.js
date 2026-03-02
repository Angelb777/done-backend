const mongoose = require("mongoose");

const taskGroupSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },          // id local/cliente
    title: { type: String, required: true },       // 👈 usa "title" (Flutter)
    taskIds: { type: [String], default: [] },      // ids de tareas dentro

    // ✅ FIX: persistir si está expandida o colapsada
    // Si no existe en documentos antiguos, por defecto será true.
    expanded: { type: Boolean, default: true },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    // =========================
    // AUTH
    // =========================
    email: {
      type: String,
      required: true,
      unique: true,
      index: true,
      lowercase: true,
      trim: true,
    },

    // ✅ Solo requerido si es login normal (email/pass)
    passwordHash: {
      type: String,
      required: function () {
        return (this.authProvider || "local") === "local";
      },
      default: "",
    },

    // ✅ Nuevo: de dónde viene el login
    authProvider: {
      type: String,
      enum: ["local", "google"],
      default: "local",
      index: true,
    },

    // opcional pero útil: uid firebase para linkear
    firebaseUid: {
      type: String,
      default: "",
      index: true,
    },

    // =========================
    // PERFIL
    // =========================
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 50,
    },

    photoUrl: { type: String, default: "" },

    status: { type: String, default: "", trim: true, maxlength: 80 },

    // ✅ ORDEN de tareas por sección (array simple de strings)
    taskOrder: {
      pending: { type: [String], default: [] },
      requested: { type: [String], default: [] },
    },

    // ✅ GRUPOS (carpetas) por sección
    taskGroups: {
      pending: { type: [taskGroupSchema], default: [] },
      requested: { type: [taskGroupSchema], default: [] },
    },

    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
      index: true,
    },

    // =========================
    // ✅ PUSH (FCM)
    // =========================
    fcmTokens: {
      type: [String],
      default: [],
      index: true,
    },
  },
  { timestamps: true }
);

userSchema.methods.toPublic = function () {
  // ✅ opcional: asegurar que expanded siempre sale definido
  const normalizeGroups = (g) => {
    const out = g || { pending: [], requested: [] };
    const normList = (arr) =>
      (Array.isArray(arr) ? arr : []).map((x) => ({
        id: x.id,
        title: x.title,
        taskIds: x.taskIds || [],
        expanded: x.expanded !== false, // si es false se respeta; si falta -> true
      }));
    return {
      pending: normList(out.pending),
      requested: normList(out.requested),
    };
  };

  return {
    _id: this._id,
    email: this.email,
    name: this.name,
    photoUrl: this.photoUrl,
    status: this.status,
    role: this.role,
    authProvider: this.authProvider,

    taskOrder: this.taskOrder || { pending: [], requested: [] },
    taskGroups: normalizeGroups(this.taskGroups),

    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

module.exports = mongoose.model("User", userSchema);