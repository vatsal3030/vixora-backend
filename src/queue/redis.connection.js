import { Redis } from "ioredis";

const cleanEnv = (value) => {
  if (value === undefined || value === null) return "";

  const raw = String(value).trim();
  if (!raw) return "";

  const hasDoubleQuotes = raw.startsWith('"') && raw.endsWith('"');
  const hasSingleQuotes = raw.startsWith("'") && raw.endsWith("'");

  if (hasDoubleQuotes || hasSingleQuotes) {
    return raw.slice(1, -1).trim();
  }

  return raw;
};

const parseBool = (value, defaultValue = false) => {
  const normalized = cleanEnv(value).toLowerCase();
  if (!normalized) return defaultValue;
  return ["1", "true", "yes", "on"].includes(normalized);
};

const redisUrl = cleanEnv(process.env.REDIS_URL);
const redisHost = cleanEnv(process.env.REDIS_HOST);
const redisPort = Number(process.env.REDIS_PORT || 6379);
const redisPassword = cleanEnv(process.env.REDIS_PASSWORD) || undefined;

const hasRedisConfig = Boolean(redisUrl || redisHost);
const isRedisEnabled = parseBool(process.env.REDIS_ENABLED, false);

const baseOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  retryStrategy(times) {
    // Hard-cap reconnect attempts to avoid infinite retry loops on bad prod config.
    if (times > 10) {
      return null;
    }
    return Math.min(times * 150, 3000);
  },
};

let redisConnection = null;

if (!isRedisEnabled) {
  if (hasRedisConfig) {
    console.warn("Redis config found but REDIS_ENABLED is false. Redis will stay disabled.");
  }
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
  let lastErrorLogAt = 0;
  const ERROR_LOG_COOLDOWN_MS = 30000;

  redisConnection.on("connect", () => {
    console.log("Redis connected");
  });

  redisConnection.on("error", (err) => {
    const now = Date.now();
    if (now - lastErrorLogAt >= ERROR_LOG_COOLDOWN_MS) {
      lastErrorLogAt = now;
      console.error("Redis error:", err?.message || err);
    }
  });
}

export { redisConnection, isRedisEnabled };
