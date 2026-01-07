import "dotenv/config";
import app from "./app.js";
import prisma from "./db/prisma.js";

const PORT = process.env.PORT || 5000;
// dotenv.config();

async function startServer() {
  try {
    await prisma.$connect();
    console.log("✅ Database connected");

    const server = app.listen(PORT, () => {
      console.log(`🚀 Server running on ${PORT}`);
    });

    process.on("SIGTERM", async () => {
      console.log("🛑 Shutting down...");
      await prisma.$disconnect();
      server.close(() => process.exit(0));
    });

  } catch (error) {
    console.error("❌ Server failed to start:", error);
    process.exit(1);
  }
}

startServer();
