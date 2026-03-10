import { Router } from "express";
import { optionalJwt, verifyJwt } from "../middlewares/auth.middleware.js";
import {
  getFeedTags,
  getTagFeed,
  getHomeFeed,
  getSubscriptionsFeed,
  getTrendingFeed,
  getShortsFeed
} from "../controllers/feed.controller.js";

const router = Router();

router.get("/tags", optionalJwt, getFeedTags);
router.get("/tags/:tagName", optionalJwt, getTagFeed);
router.get("/home", verifyJwt, getHomeFeed);
router.get("/subscriptions", verifyJwt, getSubscriptionsFeed);
router.get("/trending", optionalJwt, getTrendingFeed);
router.get("/shorts", optionalJwt, getShortsFeed);

export default router;
