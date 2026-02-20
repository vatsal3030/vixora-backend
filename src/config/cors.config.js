export const normalizeOrigin = (origin) =>
  String(origin || "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\/$/, "");

export const parseAllowedOrigins = (rawValue) => {
  const fallback = [
    "http://localhost:5173",
    "https://vixora-app.vercel.app",
    "https://app.vixora.co.in",
  ];

  if (!rawValue) return fallback;

  const parsed = String(rawValue)
    .split(",")
    .map((item) => normalizeOrigin(item.replace(/^CORS_ORIGIN=/i, "")))
    .filter(Boolean);

  return parsed.length > 0 ? [...new Set(parsed)] : fallback;
};

