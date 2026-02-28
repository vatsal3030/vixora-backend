import { z } from "zod";

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

const envSchema = z
  .object({
    NODE_ENV: z.string().optional(),
    ENV_VALIDATE_STRICT: z.string().optional(),
    PORT: z.string().optional(),
    DATABASE_URL: z.string().optional(),
    CORS_ORIGIN: z.string().optional(),
    FRONTEND_URL: z.string().optional(),
    ACCESS_TOKEN_SECRET: z.string().optional(),
    REFRESH_TOKEN_SECRET: z.string().optional(),
    REDIS_ENABLED: z.string().optional(),
    REDIS_URL: z.string().optional(),
    REDIS_HOST: z.string().optional(),
    RUN_WORKER: z.string().optional(),
    RUN_WORKER_ON_DEMAND: z.string().optional(),
    QUEUE_ENABLED: z.string().optional(),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    GOOGLE_CALLBACK_URL: z.string().optional(),
    GOOGLE_FORCE_CALLBACK_URL: z.string().optional(),
    CLOUDINARY_CLOUD_NAME: z.string().optional(),
    CLOUDINARY_API_KEY: z.string().optional(),
    CLOUDINARY_API_SECRET: z.string().optional(),
  })
  .passthrough();

const pushIssue = (arr, message) => {
  if (!message) return;
  if (!arr.includes(message)) {
    arr.push(message);
  }
};

const includesOrigin = (origins, expectedOrigin) => {
  const expected = cleanEnv(expectedOrigin).replace(/\/$/, "");
  if (!expected) return true;

  const parts = cleanEnv(origins)
    .split(",")
    .map((item) => cleanEnv(item).replace(/^CORS_ORIGIN=/i, "").replace(/\/$/, ""))
    .filter(Boolean);

  if (parts.length === 0) return false;
  return parts.includes(expected);
};

const hasAnyGoogleEnv = (env) =>
  Boolean(
    cleanEnv(env.GOOGLE_CLIENT_ID) ||
      cleanEnv(env.GOOGLE_CLIENT_SECRET) ||
      cleanEnv(env.GOOGLE_CALLBACK_URL)
  );

const hasAnyCloudinaryEnv = (env) =>
  Boolean(
    cleanEnv(env.CLOUDINARY_CLOUD_NAME) ||
      cleanEnv(env.CLOUDINARY_API_KEY) ||
      cleanEnv(env.CLOUDINARY_API_SECRET)
  );

export const validateRuntimeEnv = () => {
  const parsed = envSchema.safeParse(process.env);
  const errors = [];
  const warnings = [];

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      pushIssue(errors, issue.message);
    }
  }

  const env = parsed.success ? parsed.data : process.env;
  const nodeEnv = cleanEnv(env.NODE_ENV) || "development";
  const strict = parseBool(env.ENV_VALIDATE_STRICT, nodeEnv === "production");

  const portRaw = cleanEnv(env.PORT);
  if (portRaw) {
    const port = Number(portRaw);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      pushIssue(errors, "PORT must be a valid integer between 1 and 65535");
    }
  }

  if (!cleanEnv(env.DATABASE_URL)) {
    pushIssue(errors, "DATABASE_URL is required");
  }

  if (!cleanEnv(env.CORS_ORIGIN)) {
    pushIssue(errors, "CORS_ORIGIN is required");
  }

  if (!cleanEnv(env.ACCESS_TOKEN_SECRET)) {
    pushIssue(errors, "ACCESS_TOKEN_SECRET is required");
  }

  if (!cleanEnv(env.REFRESH_TOKEN_SECRET)) {
    pushIssue(errors, "REFRESH_TOKEN_SECRET is required");
  }

  if (cleanEnv(env.CORS_ORIGIN).includes("CORS_ORIGIN=")) {
    pushIssue(
      warnings,
      'CORS_ORIGIN value contains duplicated prefix "CORS_ORIGIN=". Remove it from value.'
    );
  }

  const databaseUrlRaw = String(env.DATABASE_URL ?? "").trim();
  if (
    (databaseUrlRaw.startsWith('"') && databaseUrlRaw.endsWith('"')) ||
    (databaseUrlRaw.startsWith("'") && databaseUrlRaw.endsWith("'"))
  ) {
    pushIssue(warnings, "DATABASE_URL appears quoted. Keep it unquoted in deployment env.");
  }

  const redisEnabled = parseBool(env.REDIS_ENABLED, false);
  if (redisEnabled && !cleanEnv(env.REDIS_URL) && !cleanEnv(env.REDIS_HOST)) {
    pushIssue(errors, "REDIS_ENABLED=true requires REDIS_URL (preferred) or REDIS_HOST");
  }

  const workerEnabled = parseBool(env.RUN_WORKER, nodeEnv !== "production");
  const workerOnDemandEnabled = parseBool(env.RUN_WORKER_ON_DEMAND, nodeEnv === "production");
  const queueEnabled = parseBool(env.QUEUE_ENABLED, workerEnabled || workerOnDemandEnabled);
  if (queueEnabled && !redisEnabled) {
    pushIssue(
      warnings,
      "QUEUE_ENABLED is true while REDIS_ENABLED is false; queue will run in fallback/direct mode."
    );
  }

  if (hasAnyGoogleEnv(env)) {
    if (!cleanEnv(env.GOOGLE_CLIENT_ID)) {
      pushIssue(errors, "GOOGLE_CLIENT_ID is required when Google OAuth is configured");
    }
    if (!cleanEnv(env.GOOGLE_CLIENT_SECRET)) {
      pushIssue(errors, "GOOGLE_CLIENT_SECRET is required when Google OAuth is configured");
    }
    if (!cleanEnv(env.GOOGLE_CALLBACK_URL)) {
      pushIssue(errors, "GOOGLE_CALLBACK_URL is required when Google OAuth is configured");
    }
  }

  if (parseBool(env.GOOGLE_FORCE_CALLBACK_URL, false) && !cleanEnv(env.GOOGLE_CALLBACK_URL)) {
    pushIssue(errors, "GOOGLE_FORCE_CALLBACK_URL=true requires GOOGLE_CALLBACK_URL");
  }

  if (hasAnyCloudinaryEnv(env)) {
    if (!cleanEnv(env.CLOUDINARY_CLOUD_NAME)) {
      pushIssue(errors, "CLOUDINARY_CLOUD_NAME is required when Cloudinary is configured");
    }
    if (!cleanEnv(env.CLOUDINARY_API_KEY)) {
      pushIssue(errors, "CLOUDINARY_API_KEY is required when Cloudinary is configured");
    }
    if (!cleanEnv(env.CLOUDINARY_API_SECRET)) {
      pushIssue(errors, "CLOUDINARY_API_SECRET is required when Cloudinary is configured");
    }
  }

  if (cleanEnv(env.FRONTEND_URL) && cleanEnv(env.CORS_ORIGIN) && !includesOrigin(env.CORS_ORIGIN, env.FRONTEND_URL)) {
    pushIssue(
      warnings,
      "FRONTEND_URL is not included in CORS_ORIGIN. Cookie-based auth may fail on web."
    );
  }

  const ok = errors.length === 0;

  if (!ok && strict) {
    const report = [
      "Environment validation failed (strict mode).",
      ...errors.map((line) => `- ${line}`),
    ].join("\n");
    throw new Error(report);
  }

  if (errors.length > 0) {
    console.warn(
      `Environment validation warnings (${errors.length}):\n${errors
        .map((line) => `- ${line}`)
        .join("\n")}`
    );
  }

  if (warnings.length > 0) {
    console.warn(
      `Environment advisory (${warnings.length}):\n${warnings
        .map((line) => `- ${line}`)
        .join("\n")}`
    );
  }

  return {
    ok,
    strict,
    nodeEnv,
    errors,
    warnings,
  };
};
