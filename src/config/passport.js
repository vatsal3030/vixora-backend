import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import crypto from "crypto";
import prisma from "../db/prisma.js";
import uploadOnCloudinary from "../utils/cloudinary.js";

const googleOAuthConfigured = Boolean(
  process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_CALLBACK_URL
);

const USERNAME_MAX_LENGTH = 30;
const USERNAME_MIN_LENGTH = 3;

const toUsernameBase = (value) => {
  const normalized = String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (!normalized) return "";
  return normalized.slice(0, USERNAME_MAX_LENGTH);
};

const ensureUsernameLength = (value) => {
  const raw = toUsernameBase(value);
  if (!raw) return "";
  if (raw.length >= USERNAME_MIN_LENGTH) return raw;
  return `${raw}${"user".slice(0, USERNAME_MIN_LENGTH - raw.length)}`.slice(
    0,
    USERNAME_MAX_LENGTH
  );
};

const trimBaseForSuffix = (base, suffix) => {
  const normalizedBase = ensureUsernameLength(base) || "user";
  const allowedBaseLength = Math.max(1, USERNAME_MAX_LENGTH - suffix.length);
  const trimmed = normalizedBase.slice(0, allowedBaseLength).replace(/_+$/g, "");
  return trimmed || "user";
};

const buildUsernameCandidates = ({ fullName, email, googleId }) => {
  const emailLocal = String(email || "").split("@")[0] || "";
  const googleTail = String(googleId || "").slice(-6);

  const seeds = [
    fullName,
    emailLocal,
    `${fullName}_${emailLocal}`,
    `user_${googleTail}`,
    `vixora_${googleTail}`,
  ];

  const seen = new Set();
  const candidates = [];
  for (const seed of seeds) {
    const candidate = ensureUsernameLength(seed);
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    candidates.push(candidate);
  }

  if (candidates.length === 0) {
    candidates.push(`user_${crypto.randomBytes(3).toString("hex")}`);
  }

  return candidates;
};

const isUniqueConstraintError = (error, fieldName) => {
  if (error?.code !== "P2002") return false;
  const target = error?.meta?.target;
  if (Array.isArray(target)) return target.includes(fieldName);
  if (typeof target === "string") return target.includes(fieldName);
  return false;
};

const generateUniqueUsername = async ({ fullName, email, googleId }) => {
  const baseCandidates = buildUsernameCandidates({ fullName, email, googleId });

  for (const base of baseCandidates) {
    const existing = await prisma.user.findUnique({
      where: { username: base },
      select: { id: true },
    });
    if (!existing) return base;

    for (let counter = 1; counter <= 120; counter += 1) {
      const suffix = `_${counter}`;
      const candidate = `${trimBaseForSuffix(base, suffix)}${suffix}`;
      const duplicate = await prisma.user.findUnique({
        where: { username: candidate },
        select: { id: true },
      });
      if (!duplicate) return candidate;
    }
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const suffix = `_${crypto.randomBytes(3).toString("hex")}`;
    const candidate = `${trimBaseForSuffix("user", suffix)}${suffix}`;
    const duplicate = await prisma.user.findUnique({
      where: { username: candidate },
      select: { id: true },
    });
    if (!duplicate) return candidate;
  }

  throw new Error("Failed to generate unique username");
};

const ensureGoogleUserHasUsername = async (user, profile) => {
  if (user?.username) return user;

  const generatedUsername = await generateUniqueUsername({
    fullName: user?.fullName || profile?.displayName || "",
    email: user?.email || profile?.emails?.[0]?.value || "",
    googleId: profile?.id || user?.providerId || "",
  });

  try {
    return await prisma.user.update({
      where: { id: user.id },
      data: { username: generatedUsername },
    });
  } catch (error) {
    if (isUniqueConstraintError(error, "username")) {
      const retryUsername = await generateUniqueUsername({
        fullName: user?.fullName || profile?.displayName || "",
        email: user?.email || profile?.emails?.[0]?.value || "",
        googleId: profile?.id || user?.providerId || "",
      });
      return prisma.user.update({
        where: { id: user.id },
        data: { username: retryUsername },
      });
    }
    throw error;
  }
};

if (googleOAuthConfigured) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL,
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const googleId = profile.id;
          const email = profile.emails?.[0]?.value?.toLowerCase();
          const fullName = profile.displayName;
          const googleAvatarUrl = profile.photos?.[0]?.value;

          if (!email) {
            return done(null, false, {
              message: "Google account has no email",
            });
          }

          let user = await prisma.user.findFirst({
            where: {
              providerId: googleId,
              authProvider: "GOOGLE",
            },
          });

          if (user) {
            if (user.isDeleted) {
              return done(null, false, {
                message: "Account deleted. Please restore.",
              });
            }
            user = await ensureGoogleUserHasUsername(user, profile);
            return done(null, user);
          }

          const existingEmailUser = await prisma.user.findUnique({
            where: { email },
          });

          if (existingEmailUser) {
            if (existingEmailUser.authProvider === "GOOGLE") {
              if (existingEmailUser.isDeleted) {
                return done(null, false, {
                  message: "Account deleted. Please restore.",
                });
              }

              user = await prisma.user.update({
                where: { id: existingEmailUser.id },
                data: {
                  providerId: existingEmailUser.providerId || googleId,
                  emailVerified: true,
                },
              });
              user = await ensureGoogleUserHasUsername(user, profile);
              return done(null, user);
            }

            return done(null, false, {
              message: "Email already registered using password",
            });
          }

          let avatar = null;
          let avatarPublicId = null;

          if (googleAvatarUrl) {
            const uploadedAvatar = await uploadOnCloudinary(googleAvatarUrl, {
              folder: "avatars/google",
              resource_type: "image",
            });

            avatar = uploadedAvatar?.secure_url || null;
            avatarPublicId = uploadedAvatar?.public_id || null;
          }

          const generatedUsername = await generateUniqueUsername({
            fullName,
            email,
            googleId,
          });

          try {
            user = await prisma.user.create({
              data: {
                fullName,
                email,
                username: generatedUsername,
                avatar,
                avatarPublicId,
                authProvider: "GOOGLE",
                providerId: googleId,
                emailVerified: true,
                password: null,
              },
            });
          } catch (error) {
            if (!isUniqueConstraintError(error, "username")) {
              throw error;
            }

            const retryUsername = await generateUniqueUsername({
              fullName,
              email,
              googleId,
            });

            user = await prisma.user.create({
              data: {
                fullName,
                email,
                username: retryUsername,
                avatar,
                avatarPublicId,
                authProvider: "GOOGLE",
                providerId: googleId,
                emailVerified: true,
                password: null,
              },
            });
          }

          return done(null, user);
        } catch (error) {
          return done(error);
        }
      }
    )
  );
} else {
  console.warn(
    "Google OAuth disabled: missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_CALLBACK_URL"
  );
}

export const isGoogleOAuthConfigured = googleOAuthConfigured;

export default passport;
