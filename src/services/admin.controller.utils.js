import ApiError from "../utils/ApiError.js";

export const MAX_ADMIN_LIST_LIMIT = 100;

export const normalizeText = (value) => String(value ?? "").trim();

export const normalizeOptionalText = (value, maxLength = 500) => {
  const text = normalizeText(value);
  if (!text) return null;
  return text.slice(0, maxLength);
};

export const parseBoolQuery = (value) => {
  const raw = normalizeText(value).toLowerCase();
  if (!raw) return undefined;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return undefined;
};

export const parseDateQuery = (value) => {
  const raw = normalizeText(value);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const getDateRangeFilter = (query) => {
  const from = parseDateQuery(query?.from);
  const to = parseDateQuery(query?.to);

  if (!from && !to) return null;

  const range = {};
  if (from) range.gte = from;
  if (to) range.lte = to;
  return range;
};

export const toIsoDate = (value) => new Date(value).toISOString().split("T")[0];

export const createDailyBuckets = ({ start, end }) => {
  const map = new Map();
  const dayMs = 24 * 60 * 60 * 1000;

  for (let ts = start.getTime(); ts <= end.getTime(); ts += dayMs) {
    map.set(toIsoDate(ts), 0);
  }

  return map;
};

export const incrementDailyBucket = (map, at, increment = 1) => {
  const key = toIsoDate(at);
  if (!map.has(key)) return;
  map.set(key, Number(map.get(key) || 0) + increment);
};

export const dailyBucketToSeries = (map) =>
  [...map.entries()].map(([date, value]) => ({
    date,
    value,
  }));

export const toUserSummary = (user) =>
  user
    ? {
        id: user.id,
        fullName: user.fullName,
        username: user.username,
        email: user.email,
        avatar: user.avatar,
        role: user.role,
      }
    : null;

export const ensureRequiredId = (id, fieldName) => {
  const value = normalizeText(id);
  if (!value) {
    throw new ApiError(400, `${fieldName} is required`);
  }
  return value;
};

export const ensureEnumValue = ({ value, allowedValues, fieldName }) => {
  if (!allowedValues.includes(value)) {
    throw new ApiError(400, `Invalid ${fieldName}`);
  }
};
