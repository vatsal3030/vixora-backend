import { Router } from "express";
import { optionalJwt, verifyJwt } from "../middlewares/auth.middleware.js";
import {
  getHomeFeed,
  getSubscriptionsFeed,
  getTrendingFeed,
  getShortsFeed
} from "../controllers/feed.controller.js";

const router = Router();

router.get("/home", verifyJwt, getHomeFeed);
router.get("/subscriptions", verifyJwt, getSubscriptionsFeed);
router.get("/trending", optionalJwt, getTrendingFeed);
router.get("/shorts", optionalJwt, getShortsFeed);

export default router;
