import { z } from "zod";

export const settingsSchema = z.object({

  profileVisibility: z.enum(["PUBLIC", "PRIVATE"]).optional(),

  showSubscriptions: z.boolean().optional(),
  showLikedVideos: z.boolean().optional(),
  allowComments: z.boolean().optional(),
  allowMentions: z.boolean().optional(),

  emailNotifications: z.boolean().optional(),
  commentNotifications: z.boolean().optional(),
  subscriptionNotifications: z.boolean().optional(),
  systemAnnouncements: z.boolean().optional(),

  autoplayNext: z.boolean().optional(),
  defaultPlaybackSpeed: z.number().min(0.25).max(3).optional(),
  saveWatchHistory: z.boolean().optional(),

  showProgressBar: z.boolean().optional(),
  showViewCount: z.boolean().optional(),
  showVideoDuration: z.boolean().optional(),
  showChannelName: z.boolean().optional(),

  personalizeRecommendations: z.boolean().optional(),
  showTrending: z.boolean().optional(),
  hideShorts: z.boolean().optional()

});
