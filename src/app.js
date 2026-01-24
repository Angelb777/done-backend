const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const path = require("path");

const { errorHandler } = require("./middleware/errorHandler");

const authRoutes = require("./routes/auth.routes");
const usersRoutes = require("./routes/users.routes");
const chatsRoutes = require("./routes/chats.routes");
const messagesRoutes = require("./routes/messages.routes");
const dashboardRoutes = require("./routes/dashboard.routes");
const devRoutes = require("./routes/dev.routes");
const tasksRoutes = require("./routes/tasks.routes");
const meRoutes = require("./routes/me.routes");
const adminRoutes = require("./routes/admin.routes");

const app = express();

/**
 * Helmet: en local/lan (http) Chrome da guerra con CSP/headers.
 * Para que tu landing funcione SIN fricción:
 * - Desactivamos contentSecurityPolicy (no te bloquea scripts inline)
 * - Dejamos el resto de helmet
 */
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginOpenerPolicy: false,
    xContentTypeOptions: false,
  })
);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use(morgan("dev"));

// ---------------------------
// STATIC
// ---------------------------

// uploads (adjuntos)
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

// assets (imgs, etc.)
app.use("/assets", express.static(path.join(process.cwd(), "assets")));

// public (landing + css)
app.use(express.static(path.join(process.cwd(), "public")));

// favicon: evita que el navegador haga locuras con /favicon.ico
app.get("/favicon.ico", (req, res) => {
  res.sendFile(path.join(process.cwd(), "assets", "img", "ticklogo.png"));
});

// salud
app.get("/health", (req, res) => res.json({ ok: true }));

// ---------------------------
// API ROUTES
// ---------------------------
app.use("/auth", authRoutes);
app.use("/users", usersRoutes);
app.use("/chats", chatsRoutes);

// messages
app.use("/", messagesRoutes);         // /chats/:chatId/messages
app.use("/messages", messagesRoutes); // Flutter: /messages/send /upload /task/status

app.use("/dashboard", dashboardRoutes);
app.use("/dev", devRoutes);
app.use("/tasks", tasksRoutes);
app.use("/me", meRoutes);
app.use("/admin", adminRoutes);

// ---------------------------
// WEB ROUTES (bonitas)
// ---------------------------
app.get("/", (req, res) =>
  res.sendFile(path.join(process.cwd(), "public", "index.html"))
);
app.get("/login", (req, res) =>
  res.sendFile(path.join(process.cwd(), "public", "login.html"))
);
app.get("/app", (req, res) =>
  res.sendFile(path.join(process.cwd(), "public", "app.html"))
);
app.get("/chat", (req, res) =>
  res.sendFile(path.join(process.cwd(), "public", "chat.html"))
);
app.get("/admin-panel", (req, res) =>
  res.sendFile(path.join(process.cwd(), "public", "admin.html"))
);

// error handler al final
app.use(errorHandler);

module.exports = app;
