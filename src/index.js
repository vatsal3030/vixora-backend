import "dotenv/config";
import app from "./app.js";
import prisma from "./db/prisma-new.js";

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    // Connect to database
    await prisma.$queryRaw`SELECT 1`;
    console.log("✅ Database connected");

    const server = app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
    });

    // Graceful shutdown
    process.on("SIGTERM", async () => {
      console.log("\n🛑 Shutting down...");
      server.close(async () => {
        await prisma.$disconnect();
        console.log("✅ Database disconnected");
        process.exit(0);
      });
    });
  } catch (error) {
    console.error("❌ Failed to start server:", error.message);
    await prisma.$disconnect();
    process.exit(1);
  }
}

startServer();
