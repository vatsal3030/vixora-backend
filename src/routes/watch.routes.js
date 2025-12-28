import express from "express";
import { watchVideo } from "../controllers/watch.controller.js";

const router = express.Router();

router.get("/:videoId", watchVideo);

export default router;
