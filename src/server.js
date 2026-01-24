require("dotenv").config();
const { connectDB } = require("./config/db");
const { startScheduler } = require("./services/scheduler");
const app = require("./app");

const PORT = process.env.PORT || 3000;

async function bootstrap() {
  await connectDB();

  app.listen(PORT, "0.0.0.0", () => {
  console.log(`DONE backend listening on http://0.0.0.0:${PORT}`);
  });


  // Scheduler to publish scheduled messages
  startScheduler();
}

bootstrap().catch((err) => {
  console.error("Fatal bootstrap error:", err);
  process.exit(1);
});
