import passport from "passport";
import asyncHandler from "../utils/asyncHandler.js";
import ApiError from "../utils/ApiError.js";
import {
    generateAccessToken,
    generateRefreshToken,
} from "../utils/jwt.js";
import prisma from "../db/prisma.js";

/*
  STEP 1: Redirect user to Google
*/
export const googleAuth = asyncHandler(async (req, res, next) => {
    passport.authenticate("google", {
        scope: ["profile", "email"],
    })(req, res, next);
});

/*
  STEP 2: Google callback
*/
export const googleAuthCallback = asyncHandler(async (req, res, next) => {
    passport.authenticate(
        "google",
        { session: false },
        async (err, user, info) => {
            try {
                if (err) {
                    return next(err); // real server error
                }

                if (!user) {
                    const reason = info?.message || "google_auth_failed";
                    return res.redirect(
                        `${process.env.FRONTEND_URL}/login?error=${encodeURIComponent(reason)}`
                    );
                }

                if (!process.env.FRONTEND_URL) {
                    throw new ApiError(500, "FRONTEND_URL not configured");
                }

                // 🔐 Generate tokens
                const accessToken = generateAccessToken(user);
                const refreshToken = generateRefreshToken(user);

                // Persist refresh token
                await prisma.user.update({
                    where: { id: user.id },
                    data: { refreshToken },
                });

                const isProduction = process.env.NODE_ENV === "production";

                const cookieOptions = {
                    httpOnly: true,
                    secure: isProduction,              // ✅ false on localhost
                    sameSite: isProduction ? "none" : "lax",
                };

                return res
                    .cookie("accessToken", accessToken, cookieOptions)
                    .cookie("refreshToken", refreshToken, cookieOptions)
                    .redirect(process.env.FRONTEND_URL);
            } catch (error) {
                console.error("Google auth failed:", err?.message);
                return next(error);
            }
        }
    )(req, res, next);
});
