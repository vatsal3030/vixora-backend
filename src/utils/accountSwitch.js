import crypto from "crypto";
import jwt from "jsonwebtoken";
import ApiError from "./ApiError.js";

const normalizeText = (value) => String(value ?? "").trim();

const cleanEnv = (value) => {
  const raw = normalizeText(value);
  if (!raw) return "";
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    return raw.slice(1, -1).trim();
  }
  return raw;
};

const ACCOUNT_SWITCH_SECRET =
  cleanEnv(process.env.ACCOUNT_SWITCH_SECRET) ||
  cleanEnv(process.env.REFRESH_TOKEN_SECRET);
const ACCOUNT_SWITCH_EXPIRY = cleanEnv(process.env.ACCOUNT_SWITCH_EXPIRY) || "30d";

const buildRefreshFingerprint = (refreshToken) => {
  const token = normalizeText(refreshToken);
  if (!token) return "";

  return crypto
    .createHash("sha256")
    .update(`${ACCOUNT_SWITCH_SECRET}:${token}`)
    .digest("hex");
};

export const createAccountSwitchToken = ({ userId, refreshToken }) => {
  if (!ACCOUNT_SWITCH_SECRET) {
    throw new ApiError(500, "ACCOUNT_SWITCH_SECRET or REFRESH_TOKEN_SECRET is required");
  }

  const uid = normalizeText(userId);
  const fingerprint = buildRefreshFingerprint(refreshToken);

  if (!uid || !fingerprint) {
    throw new ApiError(400, "Invalid account switch token payload");
  }

  return jwt.sign(
    {
      uid,
      fp: fingerprint,
      purpose: "ACCOUNT_SWITCH",
    },
    ACCOUNT_SWITCH_SECRET,
    {
      expiresIn: ACCOUNT_SWITCH_EXPIRY,
    }
  );
};

export const verifyAccountSwitchToken = (token) => {
  if (!ACCOUNT_SWITCH_SECRET) {
    throw new ApiError(500, "ACCOUNT_SWITCH_SECRET or REFRESH_TOKEN_SECRET is required");
  }

  const payload = jwt.verify(token, ACCOUNT_SWITCH_SECRET);
  if (payload?.purpose !== "ACCOUNT_SWITCH") {
    throw new ApiError(401, "Invalid account switch token");
  }

  return payload;
};

export const isAccountSwitchTokenValidForRefreshToken = ({
  tokenPayload,
  refreshToken,
}) => {
  if (!tokenPayload?.fp) return false;
  const currentFingerprint = buildRefreshFingerprint(refreshToken);
  return Boolean(currentFingerprint && currentFingerprint === tokenPayload.fp);
};
