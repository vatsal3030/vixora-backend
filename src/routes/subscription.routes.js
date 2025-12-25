import { Router } from "express";
import {
    getSubscribedChannels,
    getSubscriberCount,
    toggleSubscription,
} from "../controllers/subscription.controller.js";
import { verifyJwt } from "../middlewares/auth.middleware.js";

const router = Router();

// 🔐 Protected routes
router.use(verifyJwt);

// Subscribe / Unsubscribe a channel
router
    .route("/c/:channelId")
    .post(toggleSubscription);

// Get subscriber count of a channel (public-style but auth kept simple)
router
    .route("/c/:channelId/subscribers/count")
    .get(getSubscriberCount);

// Get channels logged-in user is subscribed to
router
    .route("/u/subscriptions")
    .get(getSubscribedChannels);

export default router;
