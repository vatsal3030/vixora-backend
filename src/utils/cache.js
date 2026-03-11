import crypto from "crypto";
import {
  getRedisConnection,
  isCacheEnabled,
  isRedisCacheEnabled,
} from "../queue/redis.connection.js";
import { metrics } from "../observability/usage.metrics.js";

const parseBool = (value, defaultValue = false) => {
  if (value === undefined || value === null || value === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
};

const normalizeList = (value) =>
  String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

const parsePositiveInt = (value, defaultValue) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultValue;
  return Math.floor(parsed);
};

const NODE_ENV = String(process.env.NODE_ENV || "").trim();
const CACHE_NAMESPACE = String(process.env.CACHE_NAMESPACE || "vixora").trim();
const CACHE_DEFAULT_TTL_SECONDS = parsePositiveInt(
  process.env.CACHE_DEFAULT_TTL_SECONDS,
  30
);
const CACHE_L1_ENABLED = parseBool(process.env.CACHE_L1_ENABLED, true);
const CACHE_L1_MAX_ENTRIES = parsePositiveInt(process.env.CACHE_L1_MAX_ENTRIES, 300);
const CACHE_REDIS_MIN_TTL_SECONDS = parsePositiveInt(
  process.env.CACHE_REDIS_MIN_TTL_SECONDS,
  NODE_ENV === "production" ? 60 : 15
);
const CACHE_REDIS_SCOPE_MODE = String(process.env.CACHE_REDIS_SCOPE_MODE || "allowlist")
  .trim()
  .toLowerCase();
const CACHE_REDIS_SCOPE_ALLOWLIST_RAW =
  process.env.CACHE_REDIS_SCOPE_ALLOWLIST !== undefined
    ? String(process.env.CACHE_REDIS_SCOPE_ALLOWLIST)
    : NODE_ENV === "production"
      ? "video:detail,channel:info,channel:about"
      : "";
const CACHE_REDIS_SCOPE_ALLOWLIST = normalizeList(CACHE_REDIS_SCOPE_ALLOWLIST_RAW);
const CACHE_REDIS_ALLOW_ALL_SCOPES =
  CACHE_REDIS_SCOPE_MODE === "all" ||
  CACHE_REDIS_SCOPE_ALLOWLIST.includes("*") ||
  CACHE_REDIS_SCOPE_ALLOWLIST.includes("all");

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

const isRedisScopeAllowed = (scope) => {
  if (CACHE_REDIS_ALLOW_ALL_SCOPES) return true;
  if (CACHE_REDIS_SCOPE_ALLOWLIST.length === 0) return true;
  return CACHE_REDIS_SCOPE_ALLOWLIST.some((allowedScope) =>
    scope === allowedScope || scope.startsWith(`${allowedScope}:`)
  );
};

export const getCachedValue = async ({ scope, params = {} }) => {
  const key = buildCacheKey(scope, params);

  if (!isCacheEnabled) {
    const result = { hit: false, value: null, source: "disabled", key };
    metrics.recordCacheGet({ scope, source: result.source, hit: false });
    return result;
  }

  const l1Value = readL1(key);
  if (l1Value !== null) {
    const result = { hit: true, value: l1Value, source: "l1", key };
    metrics.recordCacheGet({ scope, source: result.source, hit: true });
    return result;
  }

  if (!isRedisCacheEnabled) {
    const result = { hit: false, value: null, source: "l1-only", key };
    metrics.recordCacheGet({ scope, source: result.source, hit: false });
    return result;
  }

  if (!isRedisScopeAllowed(scope)) {
    const result = { hit: false, value: null, source: "l1-only-scope", key };
    metrics.recordCacheGet({ scope, source: result.source, hit: false });
    return result;
  }

  const redis = getRedisConnection();
  if (!redis) {
    const result = { hit: false, value: null, source: "no-redis", key };
    metrics.recordCacheGet({ scope, source: result.source, hit: false });
    return result;
  }

  try {
    const raw = await redis.get(key);
    if (!raw) {
      const result = { hit: false, value: null, source: "miss", key };
      metrics.recordCacheGet({ scope, source: result.source, hit: false });
      return result;
    }

    const parsed = JSON.parse(raw);
    if (!parsed || parsed.e <= nowMs()) {
      // Skip delete to avoid write amplification under high cardinality keys.
      const result = { hit: false, value: null, source: "expired", key };
      metrics.recordCacheGet({ scope, source: result.source, hit: false });
      return result;
    }

    const ttlLeftSeconds = Math.max(1, Math.floor((parsed.e - nowMs()) / 1000));
    writeL1(key, parsed.d, ttlLeftSeconds);

    const result = { hit: true, value: parsed.d, source: "redis", key };
    metrics.recordCacheGet({ scope, source: result.source, hit: true });
    return result;
  } catch {
    const result = { hit: false, value: null, source: "error", key };
    metrics.recordCacheGet({ scope, source: result.source, hit: false });
    return result;
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
  metrics.recordCacheSet({ scope });

  if (!isRedisCacheEnabled) {
    metrics.recordCacheSetSkipped("disabled");
    return;
  }

  if (!isRedisScopeAllowed(scope)) {
    metrics.recordCacheSetSkipped("scope");
    return;
  }

  if (ttl < CACHE_REDIS_MIN_TTL_SECONDS) {
    // Free-tier strategy: very short TTL keys remain in L1 only.
    metrics.recordCacheSetSkipped("short-ttl");
    return;
  }

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
