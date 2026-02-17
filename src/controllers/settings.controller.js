import prisma from "../db/prisma.js";
import { settingsSchema } from "../schemas/settings.validation.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";


/**
 * GET SETTINGS
 */
export const getUserSettings = asyncHandler(async (req, res) => {
  let settings = await prisma.userSettings.findUnique({
    where: { userId: req.user.id }
  });

  // Create default settings if they don't exist
  if (!settings) {
    settings = await prisma.userSettings.create({
      data: {
        userId: req.user.id,
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
        hideShorts: false
      }
    });
  }

  return res.status(200).json(
    new ApiResponse(200, settings, "Settings fetched")
  );
});

/**
 * UPDATE SETTINGS
 */
export const updateUserSettings = asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ApiError(
      400,
      parsed.error.issues?.[0]?.message || "Invalid settings payload"
    );
  }

  const data = parsed.data;

  const updated = await prisma.userSettings.upsert({
    where: { userId },
    update: data,
    create: {
      userId,
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
  const userId = req.user.id;

  const defaultSettings = {
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
    hideShorts: false
  };

  const reset = await prisma.userSettings.upsert({
    where: { userId },
    update: defaultSettings,
    create: {
      userId,
      ...defaultSettings
    }
  });

  return res.status(200).json(
    new ApiResponse(200, reset, "Settings reset to default")
  );
});
