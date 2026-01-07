import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import prisma from "../db/prisma.js";
import ApiError from "../utils/ApiError.js";
import uploadOnCloudinary  from "../utils/cloudinary.js";

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
                    return done(new ApiError(400, "Google account has no email"));
                }

                // 1️⃣ Existing Google user
                let user = await prisma.user.findFirst({
                    where: {
                        providerId: googleId,
                        authProvider: "GOOGLE",
                    },
                });

                if (user) {
                    if (user.isDeleted) {
                        return done(
                            new ApiError(
                                403,
                                "Account deleted. Please restore your account."
                            )
                        );
                    }
                    return done(null, user);
                }

                // 2️⃣ Email collision check (LOCAL user safety)
                const existingEmailUser = await prisma.user.findUnique({
                    where: { email },
                });

                if (existingEmailUser) {
                    return done(
                        new ApiError(
                            409,
                            "Email already registered using password. Please login normally."
                        )
                    );
                }

                // 3️⃣ Upload Google avatar to Cloudinary (ONE TIME)
                let avatar = null;
                let avatarPublicId = null;

                if (googleAvatarUrl) {
                    const uploadedAvatar = await uploadOnCloudinary(
                        googleAvatarUrl,
                        "vidora/avatars"
                    );

                    avatar = uploadedAvatar?.secure_url || null;
                    avatarPublicId = uploadedAvatar?.public_id || null;
                }

                // 4️⃣ Create new Google user
                user = await prisma.user.create({
                    data: {
                        fullName,
                        email,
                        avatar,
                        avatarPublicId,
                        authProvider: "GOOGLE",
                        providerId: googleId,
                        emailVerified: true,
                        password: null,
                    },
                });

                return done(null, user);
            } catch (err) {
                return done(err);
            }
        }
    )
);

export default passport;
