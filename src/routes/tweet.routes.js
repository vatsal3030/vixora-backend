import { Router } from 'express';
import {
    createTweet,
    deleteTweet,
    getUserTweets,
    updateTweet,
    getTweetById,
    restoreTweet,
    getDeletedTweets
} from "../controllers/tweet.controller.js";
import { verifyJwt } from "../middlewares/auth.middleware.js";

const router = Router();

router.use(verifyJwt);

// ---------- STATIC ----------
router.route("/").post(createTweet);
router.route("/user/:userId").get(getUserTweets);
router.route("/trash/me").get(getDeletedTweets);

// ---------- ACTION ----------
router.route("/:tweetId/restore").patch(restoreTweet);

// ---------- MAIN DYNAMIC LAST ----------
router.route("/:tweetId")
    .get(getTweetById)
    .patch(updateTweet)
    .delete(deleteTweet);

export default router;
