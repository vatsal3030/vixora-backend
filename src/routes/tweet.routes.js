import { Router } from 'express';
import {
    createTweet,
    deleteTweet,
    getUserTweets,
    updateTweet,
    getTweetById,
    restoreTweet,
    getDeletedTweets,
    getTweetFeed,
    getHotTweetTopics,
} from "../controllers/tweet.controller.js";
import { optionalJwt, verifyJwt } from "../middlewares/auth.middleware.js";

const router = Router();

// ---------- PUBLIC FEED ----------
router.get("/feed", optionalJwt, getTweetFeed);
router.get("/topics/hot", optionalJwt, getHotTweetTopics);
router.get("/explore", optionalJwt, getTweetFeed); // alias for feed
router.get("/:tweetId", optionalJwt, getTweetById);

// ---------- STATIC ----------
router.use(verifyJwt);
router.route("/").post(createTweet);
router.route("/user/:userId").get(getUserTweets);
router.route("/trash/me").get(getDeletedTweets);

// ---------- ACTION ----------
router.route("/:tweetId/restore").patch(restoreTweet);

// ---------- MAIN DYNAMIC LAST ----------
router.route("/:tweetId")
    .patch(updateTweet)
    .delete(deleteTweet);

export default router;
