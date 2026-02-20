import { Router } from "express";
import { verifyJwt } from "../middlewares/auth.middleware.js";
import {
  blockChannel,
  createReport,
  listBlockedChannels,
  listMyReports,
  listNotInterested,
  markNotInterested,
  removeNotInterested,
  unblockChannel,
} from "../controllers/feedback.controller.js";

const router = Router();

router.use(verifyJwt);

router.get("/not-interested", listNotInterested);
router.post("/not-interested/:videoId", markNotInterested);
router.delete("/not-interested/:videoId", removeNotInterested);

router.get("/blocked-channels", listBlockedChannels);
router.post("/blocked-channels/:channelId", blockChannel);
router.delete("/blocked-channels/:channelId", unblockChannel);

router.post("/reports", createReport);
router.get("/reports/me", listMyReports);

export default router;
