import { Router } from "express";
import { optionalJwt } from "../middlewares/auth.middleware.js";
import {
  getChannelAbout,
  getChannelInfo,
  getChannelShorts,
  getChannelVideos,
  getChannelPlaylists,
  getChannelTweets
} from "../controllers/channel.controller.js";

const router = Router();

router.get("/:channelId", optionalJwt, getChannelInfo);
router.get("/:channelId/about", optionalJwt, getChannelAbout);
router.get("/:channelId/videos", getChannelVideos);
router.get("/:channelId/shorts", getChannelShorts);
router.get("/:channelId/playlists", getChannelPlaylists);
router.get("/:channelId/tweets", getChannelTweets);

export default router;
