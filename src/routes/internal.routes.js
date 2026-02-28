import { Router } from "express";
import { getInternalUsage } from "../controllers/internal.controller.js";

const router = Router();

router.get("/usage", getInternalUsage);

export default router;

