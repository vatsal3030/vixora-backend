const safeNowIso = () => new Date().toISOString();

const createCounters = () => ({
  cache: {
    get: {
      total: 0,
      hit: 0,
      miss: 0,
      bySource: {},
      byScope: {},
    },
    set: {
      total: 0,
      byScope: {},
      skippedRedisShortTtl: 0,
      skippedRedisScope: 0,
      skippedRedisDisabled: 0,
    },
  },
  ai: {
    requests: 0,
    fallback: 0,
    byProvider: {},
    quotaRejected: 0,
    globalQuotaRejected: 0,
  },
  queue: {
    enqueueAttempts: 0,
    enqueued: 0,
    enqueueRejectedBudget: 0,
    enqueueSkippedNoQueue: 0,
    fallbackDirectProcessing: 0,
  },
  worker: {
    started: 0,
    stopped: 0,
    runtimeErrors: 0,
    quotaShutdowns: 0,
  },
  redis: {
    connected: 0,
    reconnecting: 0,
    errors: 0,
    transientErrors: 0,
    quotaErrors: 0,
    hardDisabled: 0,
  },
});

const state = {
  startedAt: safeNowIso(),
  updatedAt: safeNowIso(),
  counters: createCounters(),
};

const bump = (bucket, key, amount = 1) => {
  if (!bucket || !key) return;
  bucket[key] = Number(bucket[key] || 0) + amount;
};

const touch = () => {
  state.updatedAt = safeNowIso();
};

export const metrics = {
  recordCacheGet({ scope, source, hit }) {
    const get = state.counters.cache.get;
    get.total += 1;
    if (hit) get.hit += 1;
    else get.miss += 1;
    bump(get.bySource, source || "unknown", 1);
    if (scope) {
      const scopeRow = get.byScope[scope] || { total: 0, hit: 0, miss: 0 };
      scopeRow.total += 1;
      if (hit) scopeRow.hit += 1;
      else scopeRow.miss += 1;
      get.byScope[scope] = scopeRow;
    }
    touch();
  },

  recordCacheSet({ scope }) {
    const set = state.counters.cache.set;
    set.total += 1;
    bump(set.byScope, scope || "unknown", 1);
    touch();
  },

  recordCacheSetSkipped(reason) {
    const set = state.counters.cache.set;
    if (reason === "short-ttl") set.skippedRedisShortTtl += 1;
    if (reason === "scope") set.skippedRedisScope += 1;
    if (reason === "disabled") set.skippedRedisDisabled += 1;
    touch();
  },

  recordAiRequest({ provider, fallback = false }) {
    const ai = state.counters.ai;
    ai.requests += 1;
    if (fallback) ai.fallback += 1;
    bump(ai.byProvider, provider || "unknown", 1);
    touch();
  },

  recordAiQuotaRejected({ global = false } = {}) {
    const ai = state.counters.ai;
    if (global) ai.globalQuotaRejected += 1;
    else ai.quotaRejected += 1;
    touch();
  },

  recordQueueEvent(event) {
    const queue = state.counters.queue;
    if (event && Object.prototype.hasOwnProperty.call(queue, event)) {
      queue[event] += 1;
      touch();
    }
  },

  recordWorkerEvent(event) {
    const worker = state.counters.worker;
    if (event && Object.prototype.hasOwnProperty.call(worker, event)) {
      worker[event] += 1;
      touch();
    }
  },

  recordRedisEvent(event) {
    const redis = state.counters.redis;
    if (event && Object.prototype.hasOwnProperty.call(redis, event)) {
      redis[event] += 1;
      touch();
    }
  },

  snapshot() {
    return {
      startedAt: state.startedAt,
      updatedAt: state.updatedAt,
      uptimeSeconds: Math.max(
        0,
        Math.floor((Date.now() - new Date(state.startedAt).getTime()) / 1000)
      ),
      counters: state.counters,
    };
  },

  reset() {
    state.startedAt = safeNowIso();
    state.updatedAt = state.startedAt;
    state.counters = createCounters();
  },
};

