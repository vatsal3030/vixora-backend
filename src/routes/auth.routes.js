import { Router } from 'express';
import {
    googleAuth,
    googleAuthCallback,
} from "../controllers/auth.controller.js"
import rateLimit from "express-rate-limit";

const router = Router();

const googleAuthLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 50,
});

router.get("/google", googleAuthLimiter, googleAuth);
router.get("/google/callback", googleAuthLimiter, googleAuthCallback);

export default router