import { Router } from 'express';
import {
    addComment,
    deleteComment,
    getVideoComments,
    getCommentReplies,
    updateComment,
} from "../controllers/comment.controller.js"
import { optionalJwt, verifyJwt } from '../middlewares/auth.middleware.js';

const router = Router();

router.get("/:videoId", optionalJwt, getVideoComments);
router.post("/:videoId", verifyJwt, addComment);
router.get("/c/:commentId/replies", optionalJwt, getCommentReplies);
router.route("/c/:commentId").delete(verifyJwt, deleteComment).patch(verifyJwt, updateComment);

export default router
