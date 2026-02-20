import { z } from "zod";

const booleanField = () =>
  z.preprocess((value) => {
    if (value === "true") return true;
    if (value === "false") return false;
    return value;
  }, z.boolean());

const playbackSpeedField = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") return value;
  if (typeof value === "string") return Number(value);
  return value;
}, z.number().min(0.25).max(3));

export const settingsSchema = z
  .object({
    profileVisibility: z.enum(["PUBLIC", "PRIVATE"]).optional(),

    showSubscriptions: booleanField().optional(),
    showLikedVideos: booleanField().optional(),
    allowComments: booleanField().optional(),
    allowMentions: booleanField().optional(),

    emailNotifications: booleanField().optional(),
    commentNotifications: booleanField().optional(),
    subscriptionNotifications: booleanField().optional(),
    systemAnnouncements: booleanField().optional(),

    autoplayNext: booleanField().optional(),
    defaultPlaybackSpeed: playbackSpeedField.optional(),
    saveWatchHistory: booleanField().optional(),

    showProgressBar: booleanField().optional(),
    showViewCount: booleanField().optional(),
    showVideoDuration: booleanField().optional(),
    showChannelName: booleanField().optional(),

    personalizeRecommendations: booleanField().optional(),
    showTrending: booleanField().optional(),
    hideShorts: booleanField().optional(),
  })
  .strict();
