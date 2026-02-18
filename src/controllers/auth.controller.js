import passport from "passport";
import asyncHandler from "../utils/asyncHandler.js";
import ApiError from "../utils/ApiError.js";
import {
    generateAccessToken,
    generateRefreshToken,
} from "../utils/jwt.js";
import prisma from "../db/prisma.js";
import { isGoogleOAuthConfigured } from "../config/passport.js";

/*
  STEP 1: Redirect user to Google
*/
import crypto from "crypto";

export const googleAuth = asyncHandler(async (req, res, next) => {
    if (!isGoogleOAuthConfigured) {
        throw new ApiError(503, "Google OAuth is not configured");
    }

    const state = crypto.randomBytes(16).toString("hex");

    res.cookie("oauth_state", state, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
        maxAge: 10 * 60 * 1000
    });

    passport.authenticate("google", {
        scope: ["profile", "email"],
        state
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

    passport.authenticate(
        "google",
        { session: false },
        async (err, user, info) => {

            try {

                if (err) return next(err);

                // ✅ STATE CHECK
                if (req.query.state !== req.cookies.oauth_state) {
                    throw new ApiError(403, "Invalid OAuth state");
                }

                res.clearCookie("oauth_state");

                if (!user) {
                    const reason = info?.message || "google_auth_failed";
                    return res.redirect(`${frontend}/login?error=${encodeURIComponent(reason)}`);
                }

                const dbUser = await prisma.user.findUnique({
                    where: { id: user.id }
                });

                if (!dbUser || dbUser.isDeleted) {
                    throw new ApiError(403, "Account not available");
                }

                const accessToken = generateAccessToken(dbUser);
                const refreshToken = generateRefreshToken(dbUser);

                await prisma.user.update({
                    where: { id: dbUser.id },
                    data: { refreshToken }
                });

                const isProd = process.env.NODE_ENV === "production";

                const cookieOptions = {
                    httpOnly: true,
                    secure: isProd,
                    sameSite: isProd ? "none" : "lax",
                    path: "/"
                };

                return res
                    .cookie("accessToken", accessToken, cookieOptions)
                    .cookie("refreshToken", refreshToken, cookieOptions)
                    .redirect(frontend);

            } catch (error) {
                return next(error);
            }

        }
    )(req, res, next);
});
