export const normalizeOrigin = (origin) =>
  String(origin || "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\/$/, "");

export const parseAllowedOrigins = (rawValue, additionalOrigins = []) => {
  const isProduction = String(process.env.NODE_ENV || "").trim() === "production";
  const fallback = [
    "http://localhost:5173",
    "https://vixora-app.vercel.app",
    "https://app.vixora.co.in",
  ];

  const normalizedAdditional = (additionalOrigins || [])
    .map((item) => normalizeOrigin(item))
    .filter(Boolean);

  if (!rawValue) {
    // Production should not silently fallback to broad defaults.
    if (isProduction) {
      return [...new Set(normalizedAdditional)];
    }

    return normalizedAdditional.length > 0
      ? [...new Set([...fallback, ...normalizedAdditional])]
      : fallback;
  }

  const parsed = String(rawValue)
    .split(",")
    .map((item) => normalizeOrigin(item.replace(/^CORS_ORIGIN=/i, "")))
    .filter(Boolean);

  if (parsed.length === 0 && normalizedAdditional.length === 0) {
    return isProduction ? [] : fallback;
  }

  return [...new Set([...parsed, ...normalizedAdditional])];
};
