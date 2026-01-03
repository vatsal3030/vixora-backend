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

const app = express();

/* ---------- GLOBAL MIDDLEWARE ---------- */
app.use(helmet());

const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",")
  : ["http://localhost:5173"];

app.use(
  cors({
    origin: (origin, callback) => {
      // allow server-to-server & tools like Postman
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
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
