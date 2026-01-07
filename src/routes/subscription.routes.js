import { Router } from "express";
import {
    getSubscribedChannels,
    getSubscriberCount,
    toggleSubscription,
    getSubscribedVideos,
    getSubscriptionStatus,
    setNotificationLevel
} from "../controllers/subscription.controller.js";
import { verifyJwt } from "../middlewares/auth.middleware.js";

const router = Router();

// 🔐 Protected routes
router.use(verifyJwt);

router.get("/", getSubscribedVideos);

// Subscribe / Unsubscribe a channel
router
    .route("/c/:channelId/subscribe")
    .post(toggleSubscription);

// Get subscriber count of a channel (public-style but auth kept simple)
router
    .route("/c/:channelId/subscribers/count")
    .get(getSubscriberCount);

// Get channels logged-in user is subscribed to
router
    .route("/u/subscriptions")
    .get(getSubscribedChannels);

router
    .route("/c/:channelId/notifications")
    .patch(setNotificationLevel);

router
    .route("/c/:channelId/status")
    .get(getSubscriptionStatus);

export default router;
