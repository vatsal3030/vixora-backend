import { Redis } from "ioredis";

const parseBool = (value, defaultValue = false) => {
  if (value === undefined || value === null || value === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
};

const redisUrl = process.env.REDIS_URL?.trim();
const redisHost = process.env.REDIS_HOST?.trim();
const redisPort = Number(process.env.REDIS_PORT || 6379);
const redisPassword = process.env.REDIS_PASSWORD || undefined;

const hasRedisConfig = Boolean(redisUrl || redisHost);
const isRedisEnabled =
  process.env.REDIS_ENABLED !== undefined
    ? parseBool(process.env.REDIS_ENABLED, false)
    : hasRedisConfig;

const baseOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  retryStrategy(times) {
    return Math.min(times * 50, 2000);
  },
};

let redisConnection = null;

if (!isRedisEnabled) {
  console.warn("Redis disabled (REDIS_ENABLED=false or no Redis config).");
} else if (redisUrl) {
  redisConnection = new Redis(redisUrl, baseOptions);
} else if (redisHost) {
  redisConnection = new Redis({
    host: redisHost,
    port: redisPort,
    password: redisPassword,
    ...baseOptions,
  });
} else {
  console.warn("Redis enabled but configuration is missing. Redis will stay disabled.");
}

if (redisConnection) {
  redisConnection.on("connect", () => {
    console.log("Redis connected");
  });

  redisConnection.on("error", (err) => {
    console.error("Redis error:", err?.message || err);
  });
}

export { redisConnection, isRedisEnabled };
