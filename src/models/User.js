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

    taskOrder: {
      pending: [{ type: String, default: [] }],
      requested: [{ type: String, default: [] }],
    },

    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
      index: true,
    },
  },
  { timestamps: true }
);

userSchema.methods.toPublic = function () {
  return {
    _id: this._id,
    email: this.email,
    name: this.name,
    photoUrl: this.photoUrl,
    status: this.status,
    role: this.role,
    authProvider: this.authProvider,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

module.exports = mongoose.model("User", userSchema);
