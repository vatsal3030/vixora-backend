import express from "express";
import { verifyJwt } from "../middlewares/auth.middleware.js";
import {
    getDashboardOverview,
    getAnalytics,
    getTopVideos,
    getGrowthStats,
    getInsights
} from "../controllers/dashboard.controller.js";

const router = express.Router();

router.use(verifyJwt);

router.get("/overview", getDashboardOverview);
router.get("/analytics", getAnalytics);
router.get("/top-videos", getTopVideos);
router.get("/growth", getGrowthStats);
router.get("/insights", getInsights);

export default router;
