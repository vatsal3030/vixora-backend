import "dotenv/config";
import { createServer } from "node:http";
import app from "./app.js";
import prisma from "./db/prisma.js";
import { parseAllowedOrigins } from "./config/cors.config.js";
import { initSocketServer } from "./realtime/socket.server.js";

const PORT = process.env.PORT || 5000;

const parseBool = (value, defaultValue = false) => {
  if (value === undefined || value === null || value === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
};

async function startServer() {
  try {
    const shouldRunScheduler = parseBool(process.env.RUN_SCHEDULER, true);
    const shouldRunWorker = parseBool(
      process.env.RUN_WORKER,
      process.env.NODE_ENV !== "production"
    );

    if (shouldRunScheduler) {
      await import("./jobs/scheduler.js");
    } else {
      console.log("Scheduler disabled by RUN_SCHEDULER.");
    }

    if (shouldRunWorker) {
      await import("./jobs/video.worker.js");
    } else {
      console.log("Video worker disabled by RUN_WORKER.");
    }

    await prisma.$connect();
    console.log("Database connected");

    const httpServer = createServer(app);
    const allowedOrigins = parseAllowedOrigins(process.env.CORS_ORIGIN);
    initSocketServer({ httpServer, allowedOrigins });

    const server = httpServer.listen(PORT, () => {
      console.log(`Server running on ${PORT}`);
    });

    process.on("SIGTERM", async () => {
      console.log("Shutting down...");
      await prisma.$disconnect();
      server.close(() => process.exit(0));
    });
  } catch (error) {
    console.error("Server failed to start:", error);
    process.exit(1);
  }
}

startServer();
