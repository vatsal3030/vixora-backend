import prisma from "../db/prisma.js";
import { settingsSchema } from "../schemas/settings.validation.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";

const DEFAULT_USER_SETTINGS = Object.freeze({
  profileVisibility: "PUBLIC",
  showSubscriptions: true,
  showLikedVideos: true,
  allowComments: true,
  allowMentions: true,
  emailNotifications: true,
  commentNotifications: true,
  subscriptionNotifications: true,
  systemAnnouncements: true,
  autoplayNext: true,
  defaultPlaybackSpeed: 1.0,
  saveWatchHistory: true,
  showProgressBar: true,
  showViewCount: true,
  showVideoDuration: true,
  showChannelName: true,
  personalizeRecommendations: true,
  showTrending: true,
  hideShorts: false,
});

const ensureUserSettings = async (userId) =>
  prisma.userSettings.upsert({
    where: { userId },
    update: {},
    create: {
      userId,
      ...DEFAULT_USER_SETTINGS,
    },
  });


/**
 * GET SETTINGS
 */
export const getUserSettings = asyncHandler(async (req, res) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new ApiError(401, "Unauthorized");
  }

  const settings = await ensureUserSettings(userId);

  return res.status(200).json(
    new ApiResponse(200, settings, "Settings fetched")
  );
});

/**
 * UPDATE SETTINGS
 */
export const updateUserSettings = asyncHandler(async (req, res) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new ApiError(401, "Unauthorized");
  }

  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ApiError(
      400,
      parsed.error.issues?.[0]?.message || "Invalid settings payload"
    );
  }

  const data = parsed.data;
  if (Object.keys(data).length === 0) {
    throw new ApiError(400, "At least one setting field is required");
  }

  const updated = await prisma.userSettings.upsert({
    where: { userId },
    update: data,
    create: {
      userId,
      ...DEFAULT_USER_SETTINGS,
      ...data
    }
  });

  return res.status(200).json(
    new ApiResponse(200, updated, "Settings updated successfully")
  );
});

/**
 * RESET SETTINGS
 */
export const resetUserSettings = asyncHandler(async (req, res) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new ApiError(401, "Unauthorized");
  }

  const reset = await prisma.userSettings.upsert({
    where: { userId },
    update: DEFAULT_USER_SETTINGS,
    create: {
      userId,
      ...DEFAULT_USER_SETTINGS
    }
  });

  return res.status(200).json(
    new ApiResponse(200, reset, "Settings reset to default")
  );
});
