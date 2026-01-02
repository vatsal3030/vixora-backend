import prisma from "../db/prisma.js";
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

  // Allow ONLY known fields
  const allowedFields = [
    "profileVisibility",
    "showSubscriptions",
    "showLikedVideos",
    "allowComments",
    "allowMentions",

    "emailNotifications",
    "commentNotifications",
    "subscriptionNotifications",
    "systemAnnouncements",

    "autoplayNext",
    "defaultPlaybackSpeed",
    "saveWatchHistory",

    "showProgressBar",
    "showViewCount",
    "showVideoDuration",
    "showChannelName",

    "personalizeRecommendations",
    "showTrending",
    "hideShorts"
  ];

  const data = {};
  for (const key of allowedFields) {
    if (req.body[key] !== undefined) {
      data[key] = req.body[key];
    }
  }

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

  const reset = await prisma.userSettings.update({
    where: { userId },
    data: {
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

  return res.status(200).json(
    new ApiResponse(200, reset, "Settings reset to default")
  );
});
