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
const isCacheEnabled = parseBool(process.env.CACHE_ENABLED, false);
const shouldRunWorker = parseBool(
  process.env.RUN_WORKER,
  cleanEnv(process.env.NODE_ENV) !== "production"
);
const shouldRunWorkerOnDemand = parseBool(
  process.env.RUN_WORKER_ON_DEMAND,
  cleanEnv(process.env.NODE_ENV) === "production"
);
const shouldUseRedisQueue = shouldRunWorker || shouldRunWorkerOnDemand;
const shouldUseRedis = shouldUseRedisQueue || isCacheEnabled;
const REDIS_ERROR_LOG_COOLDOWN_MS = Number(process.env.REDIS_ERROR_LOG_COOLDOWN_MS || 30000);

export const isTransientRedisError = (err) => {
  const code = String(err?.code || "").toUpperCase();
  const message = String(err?.message || "").toLowerCase();

  if (code === "ECONNRESET" || code === "ETIMEDOUT" || code === "EPIPE") {
    return true;
  }

  return (
    message.includes("read econnreset") ||
    message.includes("socket hang up") ||
    message.includes("connection reset")
  );
};

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
let initialized = false;
const attachedConnections = new WeakSet();

const attachRedisListeners = (connection) => {
  if (!connection || attachedConnections.has(connection)) {
    return;
  }
  attachedConnections.add(connection);

  let lastErrorLogAt = 0;

  connection.on("connect", () => {
    console.log("Redis connected");
  });

  connection.on("reconnecting", () => {
    console.warn("Redis reconnecting...");
  });

  connection.on("error", (err) => {
    const now = Date.now();
    if (now - lastErrorLogAt >= REDIS_ERROR_LOG_COOLDOWN_MS) {
      lastErrorLogAt = now;
      const message = err?.message || String(err);
      if (isTransientRedisError(err)) {
        console.warn("Redis transient error:", message);
      } else {
        console.error("Redis error:", message);
      }
    }
  });

  if (typeof connection.duplicate === "function") {
    const originalDuplicate = connection.duplicate.bind(connection);
    connection.duplicate = (...args) => {
      const duplicated = originalDuplicate(...args);
      attachRedisListeners(duplicated);
      return duplicated;
    };
  }
};

export const getRedisConnection = () => {
  if (initialized) {
    return redisConnection;
  }

  initialized = true;

  if (!isRedisEnabled) {
    if (hasRedisConfig) {
      console.warn("Redis config found but REDIS_ENABLED is false. Redis will stay disabled.");
    }
    console.warn("Redis disabled (REDIS_ENABLED=false or no Redis config).");
    return null;
  }

  if (!shouldUseRedis) {
    console.warn("Redis connection skipped because queue + cache modes are disabled.");
    return null;
  }

  if (redisUrl) {
    redisConnection = new Redis(redisUrl, baseOptions);
    attachRedisListeners(redisConnection);
    return redisConnection;
  }

  if (redisHost) {
    redisConnection = new Redis({
      host: redisHost,
      port: redisPort,
      password: redisPassword,
      ...baseOptions,
    });
    attachRedisListeners(redisConnection);
    return redisConnection;
  }

  console.warn("Redis enabled but configuration is missing. Redis will stay disabled.");
  return null;
};

export const closeRedisConnection = async () => {
  if (!redisConnection) {
    initialized = false;
    return;
  }

  const connectionToClose = redisConnection;
  redisConnection = null;
  initialized = false;

  try {
    await connectionToClose.quit();
  } catch {
    connectionToClose.disconnect();
  }

  console.log("Redis connection closed.");
};

export { isRedisEnabled, isCacheEnabled };
