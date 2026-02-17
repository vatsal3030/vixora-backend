import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { apiLimiter } from "./middlewares/rateLimit.middleware.js";
import { globalErrorHandler } from "./middlewares/error.middleware.js";

// Routes
import userRouter from "./routes/user.routes.js";
import videoRouter from "./routes/video.routes.js";
import likeRouter from "./routes/like.routes.js";
import commentRouter from "./routes/comment.routes.js";
import subscriptionRouter from "./routes/subscription.routes.js";
import playlistRouter from "./routes/playlist.routes.js";
import tweetRouter from "./routes/tweet.routes.js";
import channelRouter from "./routes/channel.routes.js";
import notificationRouter from "./routes/notification.routes.js";
import dashboardRouter from "./routes/dashboard.routes.js";
import watchRouter from "./routes/watch.routes.js";
import watchHistoryRouter from "./routes/watchHistory.routes.js";
import feedRouter from "./routes/feed.routes.js";
import settingRouter from "./routes/settings.routes.js";
import authRouter from "./routes/auth.routes.js";
import uploadRouter from "./routes/upload.routes.js";
import mediaRoutes from "./routes/media.routes.js";

import passport from "passport";
import "./config/passport.js";

const app = express();

app.set("trust proxy", 1);


/* ---------- GLOBAL MIDDLEWARE ---------- */
app.use(helmet());

const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map(o => o.replace(/\/$/, ""))
  : [
    "http://localhost:5173",
    "https://vixora-app.vercel.app",
    "https://app.vixora.co.in"
  ];


app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);

      const normalizedOrigin = origin.replace(/\/$/, "");

      if (allowedOrigins.includes(normalizedOrigin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);


app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());


// app.use(express.json({ limit: "10mb" }));
// app.use(express.urlencoded({ extended: true, limit: "10mb" }));
// app.use(cookieParser());

/* ---------- RATE LIMIT ---------- */
app.use("/api", apiLimiter);

app.get("/healthz", (req, res) => {
  res.status(200).json({ status: "ok" });
});


app.use(passport.initialize());

/* ---------- ROUTES ---------- */
app.use("/api/v1/users", userRouter);
app.use("/api/v1/videos", videoRouter);
app.use("/api/v1/likes", likeRouter);
app.use("/api/v1/comments", commentRouter);
app.use("/api/v1/subscriptions", subscriptionRouter);
app.use("/api/v1/playlists", playlistRouter);
app.use("/api/v1/tweets", tweetRouter);
app.use("/api/v1/channels", channelRouter);
app.use("/api/v1/notifications", notificationRouter);
app.use("/api/v1/dashboard", dashboardRouter);
app.use("/api/v1/watch", watchRouter);
app.use("/api/v1/watch-history", watchHistoryRouter);
app.use("/api/v1/feed", feedRouter);
app.use("/api/v1/settings", settingRouter);
app.use("/api/v1/auth", authRouter);
app.use("/api/v1/upload", uploadRouter);
app.use("/api/media", mediaRoutes);


app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Vixora Backend is running 🚀",
    version: "1.0.0"
  });
});

/* ---------- 404 HANDLER ---------- */
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`
  });
});

/* ---------- GLOBAL ERROR HANDLER ---------- */
app.use(globalErrorHandler);

export default app;
