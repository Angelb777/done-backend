const mongoose = require("mongoose");

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

    // ✅ IMPORTANTE:
    // Para usuarios que entran con Google/Firebase NO hay password.
    // Por eso NO puede ser required:true.
    passwordHash: {
      type: String,
      required: false,
      default: "",
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

    // ya lo tenías
    photoUrl: {
      type: String,
      default: "",
    },

    // ya lo tenías
    status: {
      type: String,
      default: "",
      trim: true,
      maxlength: 80,
    },

    taskOrder: {
      pending: [{ type: String, default: [] }],
      requested: [{ type: String, default: [] }],
    },

    // =========================
    // ROLES / PERMISOS (NUEVO)
    // =========================
    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// ======================================================
// RESPUESTA PÚBLICA (NUNCA passwordHash)
// ======================================================
userSchema.methods.toPublic = function () {
  return {
    _id: this._id,
    email: this.email,
    name: this.name,
    photoUrl: this.photoUrl,
    status: this.status,
    role: this.role, // 👈 NUEVO
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

module.exports = mongoose.model("User", userSchema);
