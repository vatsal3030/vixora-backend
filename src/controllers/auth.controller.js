import crypto from "crypto";
import passport from "passport";
import prisma from "../db/prisma.js";
import { isGoogleOAuthConfigured } from "../config/passport.js";
import ApiError from "../utils/ApiError.js";
import asyncHandler from "../utils/asyncHandler.js";
import { generateAccessToken, generateRefreshToken } from "../utils/jwt.js";

const OAUTH_STATE_COOKIE = "oauth_state";
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const isProduction = process.env.NODE_ENV === "production";

const getOAuthStateCookieOptions = () => ({
  httpOnly: true,
  secure: isProduction,
  // This cookie is only for top-level OAuth redirect flow.
  sameSite: "lax",
  path: "/api/v1/auth",
  maxAge: OAUTH_STATE_TTL_MS,
});

const getOAuthCallbackUrl = (req) => {
  const forceConfiguredCallback =
    String(process.env.GOOGLE_FORCE_CALLBACK_URL || "").toLowerCase() ===
    "true";
  const configuredCallback = process.env.GOOGLE_CALLBACK_URL;

  if (forceConfiguredCallback && configuredCallback) {
    return configuredCallback;
  }

  return `${req.protocol}://${req.get("host")}/api/v1/auth/google/callback`;
};

/*
  STEP 1: Redirect user to Google
*/
export const googleAuth = asyncHandler(async (req, res, next) => {
  if (!isGoogleOAuthConfigured) {
    throw new ApiError(503, "Google OAuth is not configured");
  }

  const state = crypto.randomBytes(16).toString("hex");
  const callbackURL = getOAuthCallbackUrl(req);

  res.cookie(OAUTH_STATE_COOKIE, state, getOAuthStateCookieOptions());

  passport.authenticate("google", {
    scope: ["profile", "email"],
    state,
    callbackURL,
  })(req, res, next);
});

/*
  STEP 2: Google callback
*/
export const googleAuthCallback = asyncHandler(async (req, res, next) => {
  if (!isGoogleOAuthConfigured) {
    throw new ApiError(503, "Google OAuth is not configured");
  }

  const frontend = process.env.FRONTEND_URL;
  if (!frontend) throw new ApiError(500, "FRONTEND_URL missing");

  passport.authenticate("google", { session: false }, async (err, user, info) => {
    try {
      if (err) return next(err);

      // State must match the browser cookie set during /auth/google.
      const stateFromQuery = typeof req.query.state === "string" ? req.query.state : "";
      const stateFromCookie = req.cookies?.[OAUTH_STATE_COOKIE];

      if (!stateFromCookie || stateFromQuery !== stateFromCookie) {
        return res.redirect(
          `${frontend}/login?error=${encodeURIComponent("oauth_state_mismatch")}`
        );
      }

      const stateCookieOptions = getOAuthStateCookieOptions();
      res.clearCookie(OAUTH_STATE_COOKIE, {
        path: stateCookieOptions.path,
        httpOnly: stateCookieOptions.httpOnly,
        secure: stateCookieOptions.secure,
        sameSite: stateCookieOptions.sameSite,
      });

      if (!user) {
        const reason = info?.message || "google_auth_failed";
        return res.redirect(`${frontend}/login?error=${encodeURIComponent(reason)}`);
      }

      const dbUser = await prisma.user.findUnique({
        where: { id: user.id },
      });

      if (!dbUser || dbUser.isDeleted) {
        throw new ApiError(403, "Account not available");
      }

      const accessToken = generateAccessToken(dbUser);
      const refreshToken = generateRefreshToken(dbUser);

      await prisma.user.update({
        where: { id: dbUser.id },
        data: { refreshToken },
      });

      const cookieOptions = {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? "none" : "lax",
        path: "/",
      };

      return res
        .cookie("accessToken", accessToken, cookieOptions)
        .cookie("refreshToken", refreshToken, cookieOptions)
        .redirect(frontend);
    } catch (error) {
      return next(error);
    }
  })(req, res, next);
});
