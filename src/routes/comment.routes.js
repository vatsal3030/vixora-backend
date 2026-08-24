import { Router } from 'express';
import {
    addComment,
    deleteComment,
    getVideoComments,
    getCommentReplies,
    updateComment,
    getTweetComments,
    addTweetComment,
} from "../controllers/comment.controller.js"
import { optionalJwt, verifyJwt } from '../middlewares/auth.middleware.js';

const router = Router();

// Tweet / Post comments
router.get("/t/:tweetId", optionalJwt, getTweetComments);
router.post("/t/:tweetId", verifyJwt, addTweetComment);

// Reply and comment actions
router.get("/c/:commentId/replies", optionalJwt, getCommentReplies);
router.route("/c/:commentId").delete(verifyJwt, deleteComment).patch(verifyJwt, updateComment);

// Video comments
router.get("/:videoId", optionalJwt, getVideoComments);
router.post("/:videoId", verifyJwt, addComment);

export default router
