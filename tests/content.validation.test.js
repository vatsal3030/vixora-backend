import express from "express";
import request from "supertest";
import { addComment } from "../src/controllers/comment.controller.js";
import { createTweet } from "../src/controllers/tweet.controller.js";
import { setNotificationLevel } from "../src/controllers/subscription.controller.js";
import { saveWatchProgress } from "../src/controllers/watchHistory.controller.js";
import { globalErrorHandler } from "../src/middlewares/error.middleware.js";

const buildApp = (handler, user = { id: "user-1", emailVerified: true }) => {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = user;
    next();
  });
  app.use("/test", handler);
  app.use(globalErrorHandler);
  return app;
};

describe("Controller payload guards", () => {
  it("rejects comments above max length", async () => {
    const router = express.Router();
    router.post("/comments/:videoId", addComment);
    const app = buildApp(router);

    const response = await request(app)
      .post("/test/comments/video-1")
      .send({ content: "a".repeat(1001) });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toMatch(/comment too long/i);
  });

  it("rejects tweets above max length", async () => {
    const router = express.Router();
    router.post("/tweets", createTweet);
    const app = buildApp(router);

    const response = await request(app)
      .post("/test/tweets")
      .send({ content: "b".repeat(501) });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toMatch(/too long/i);
  });

  it("rejects invalid subscription notification level", async () => {
    const router = express.Router();
    router.patch("/subscriptions/:channelId/notifications", setNotificationLevel);
    const app = buildApp(router);

    const response = await request(app)
      .patch("/test/subscriptions/channel-1/notifications")
      .send({ level: "SUPER_LOUD" });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toMatch(/invalid notification level/i);
  });

  it("rejects watch progress above 100%", async () => {
    const router = express.Router();
    router.post("/watch-history", saveWatchProgress);
    const app = buildApp(router);

    const response = await request(app)
      .post("/test/watch-history")
      .send({ videoId: "video-1", progress: 150, duration: 1000 });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toMatch(/progress/i);
  });
});
