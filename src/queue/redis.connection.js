import { Redis } from "ioredis";

export const redisConnection = new Redis({
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: Number(process.env.REDIS_PORT || 6379),
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  retryStrategy(times) {
    return Math.min(times * 50, 2000);
  }
});


redisConnection.on("connect", () => {
  console.log("✅ Redis connected");
});

redisConnection.on("error", (err) => {
  console.error("❌ Redis error:", err);
});

