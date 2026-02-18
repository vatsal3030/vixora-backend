import crypto from "crypto";
import { getRedisConnection, isCacheEnabled } from "../queue/redis.connection.js";

const parseBool = (value, defaultValue = false) => {
  if (value === undefined || value === null || value === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
};

const parsePositiveInt = (value, defaultValue) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultValue;
  return Math.floor(parsed);
};

const CACHE_NAMESPACE = String(process.env.CACHE_NAMESPACE || "vixora").trim();
const CACHE_DEFAULT_TTL_SECONDS = parsePositiveInt(
  process.env.CACHE_DEFAULT_TTL_SECONDS,
  30
);
const CACHE_L1_ENABLED = parseBool(process.env.CACHE_L1_ENABLED, true);
const CACHE_L1_MAX_ENTRIES = parsePositiveInt(process.env.CACHE_L1_MAX_ENTRIES, 300);

const l1Cache = new Map();

const nowMs = () => Date.now();

const stableSerialize = (value) => {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }
  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    const serialized = keys.map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`);
    return `{${serialized.join(",")}}`;
  }
  return JSON.stringify(value);
};

const buildCacheKey = (scope, params = {}) => {
  const digest = crypto
    .createHash("sha1")
    .update(stableSerialize(params))
    .digest("hex");

  return `${CACHE_NAMESPACE}:${scope}:${digest}`;
};

const readL1 = (key) => {
  if (!CACHE_L1_ENABLED) return null;

  const entry = l1Cache.get(key);
  if (!entry) return null;

  if (entry.expiresAtMs <= nowMs()) {
    l1Cache.delete(key);
    return null;
  }

  return entry.value;
};

const writeL1 = (key, value, ttlSeconds) => {
  if (!CACHE_L1_ENABLED || ttlSeconds <= 0) return;

  if (l1Cache.size >= CACHE_L1_MAX_ENTRIES) {
    const oldestKey = l1Cache.keys().next().value;
    if (oldestKey) l1Cache.delete(oldestKey);
  }

  l1Cache.set(key, {
    value,
    expiresAtMs: nowMs() + ttlSeconds * 1000,
  });
};

const buildStoredValue = (value, ttlSeconds) => ({
  d: value,
  e: nowMs() + ttlSeconds * 1000,
});

export const getCachedValue = async ({ scope, params = {} }) => {
  const key = buildCacheKey(scope, params);

  if (!isCacheEnabled) {
    return { hit: false, value: null, source: "disabled", key };
  }

  const l1Value = readL1(key);
  if (l1Value !== null) {
    return { hit: true, value: l1Value, source: "l1", key };
  }

  const redis = getRedisConnection();
  if (!redis) {
    return { hit: false, value: null, source: "no-redis", key };
  }

  try {
    const raw = await redis.get(key);
    if (!raw) {
      return { hit: false, value: null, source: "miss", key };
    }

    const parsed = JSON.parse(raw);
    if (!parsed || parsed.e <= nowMs()) {
      redis.del(key).catch(() => null);
      return { hit: false, value: null, source: "expired", key };
    }

    const ttlLeftSeconds = Math.max(1, Math.floor((parsed.e - nowMs()) / 1000));
    writeL1(key, parsed.d, ttlLeftSeconds);

    return { hit: true, value: parsed.d, source: "redis", key };
  } catch {
    return { hit: false, value: null, source: "error", key };
  }
};

export const setCachedValue = async ({
  scope,
  params = {},
  value,
  ttlSeconds = CACHE_DEFAULT_TTL_SECONDS,
}) => {
  if (!isCacheEnabled) {
    return;
  }

  const key = buildCacheKey(scope, params);
  const ttl = parsePositiveInt(ttlSeconds, CACHE_DEFAULT_TTL_SECONDS);

  writeL1(key, value, ttl);

  const redis = getRedisConnection();
  if (!redis) {
    return;
  }

  const payload = JSON.stringify(buildStoredValue(value, ttl));

  try {
    await redis.set(key, payload, "EX", ttl);
  } catch {
    // Ignore cache write errors. API response should not fail because cache failed.
  }
};
