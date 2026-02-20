import { Router } from "express";
import { verifyJwt } from "../middlewares/auth.middleware.js";
import { aiLimiter } from "../middlewares/rateLimit.middleware.js";
import {
  askVideoQuestion,
  createAiSession,
  deleteVideoTranscript,
  generateVideoSummary,
  getAiSessionMessages,
  getVideoTranscriptForAi,
  getVideoSummary,
  listAiSessions,
  sendAiSessionMessage,
  upsertVideoTranscript,
} from "../controllers/ai.controller.js";

const router = Router();

router.use(verifyJwt);

router.post("/sessions", aiLimiter, createAiSession);
router.get("/sessions", listAiSessions);
router.get("/sessions/:sessionId/messages", getAiSessionMessages);
router.post("/sessions/:sessionId/messages", aiLimiter, sendAiSessionMessage);

router.get("/videos/:videoId/summary", getVideoSummary);
router.post("/videos/:videoId/summary", aiLimiter, generateVideoSummary);
router.post("/videos/:videoId/ask", aiLimiter, askVideoQuestion);
router.get("/videos/:videoId/transcript", getVideoTranscriptForAi);
router.post("/videos/:videoId/transcript", aiLimiter, upsertVideoTranscript);
router.delete("/videos/:videoId/transcript", aiLimiter, deleteVideoTranscript);

export default router;
