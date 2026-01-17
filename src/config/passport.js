import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import prisma from "../db/prisma.js";
import uploadOnCloudinary from "../utils/cloudinary.js";

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

                // 1️⃣ Existing Google user
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
                    return done(null, user);
                }

                // 2️⃣ Email collision (LOCAL account exists)
                const existingEmailUser = await prisma.user.findUnique({
                    where: { email },
                });

                if (existingEmailUser) {
                    return done(null, false, {
                        message: "Email already registered using password",
                    });
                }

                // 3️⃣ Upload avatar (optional)
                let avatar = null;
                let avatarPublicId = null;

                if (googleAvatarUrl) {
                    const uploadedAvatar = await uploadOnCloudinary(
                        googleAvatarUrl,
                        "vixora/avatars"
                    );
                    avatar = uploadedAvatar?.secure_url || null;
                    avatarPublicId = uploadedAvatar?.public_id || null;
                }

                // 4️⃣ Create Google user
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
            } catch (error) {
                return done(error); // REAL server error only
            }
        }
    )
);

export default passport;
