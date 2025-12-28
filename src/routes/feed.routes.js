import { Router } from "express";
import { verifyJwt } from "../middlewares/auth.middleware.js";
import {
  getHomeFeed,
  getSubscriptionsFeed,
  getTrendingFeed,
  getShortsFeed
} from "../controllers/feed.controller.js";

const router = Router();

router.get("/home", verifyJwt, getHomeFeed);
router.get("/subscriptions", verifyJwt, getSubscriptionsFeed);
router.get("/trending", getTrendingFeed);
router.get("/shorts", getShortsFeed);

export default router;
