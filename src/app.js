import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";


const app = express();

/* Middleware */
app.use(cors(
  {
    origin: process.env.CORS_ORIGIN || "*",
    credentials: true,
  }
));

app.use(express.json(
  {
    limit: "100kb"
  }
));

app.use(express.urlencoded({ extended: true, limit: "100kb" }));
app.use(express.static("public"));
app.use(cookieParser());

// routes
import userRouter from "./routes/user.routes.js"
import videoRouter from "./routes/video.routes.js"
import likeRouter from "./routes/like.routes.js"
import commentRouter from "./routes/comment.routes.js"
import subscriptionRouter from "./routes/subscription.routes.js"
import playlistRouter from "./routes/playlist.routes.js"
import tweetRouter from "./routes/tweet.routes.js"
import channelRouter from "./routes/channel.routes.js"
import notificationRouter from "./routes/notification.routes.js"
import dashboardRouter from "./routes/dashboard.routes.js"

// route declarations
app.use("/api/v1/users", userRouter)
app.use("/api/v1/videos", videoRouter)
app.use("/api/v1/likes", likeRouter)
app.use("/api/v1/comments", commentRouter)
app.use("/api/v1/subscriptions", subscriptionRouter)
app.use("/api/v1/playlists", playlistRouter)
app.use("/api/v1/tweets", tweetRouter)
app.use("/api/v1/channels", channelRouter)
app.use("/api/v1/notifications", notificationRouter)
app.use("/api/v1/dashboard", dashboardRouter)

export default app;
