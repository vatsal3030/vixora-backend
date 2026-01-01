import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { User } from "../models/user.model.js";

// Get user settings
const getSettings = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user?._id).select("settings");
  
  if (!user) {
    throw new ApiError(404, "User not found");
  }

  return res
    .status(200)
    .json(new ApiResponse(200, user.settings || {}, "Settings retrieved successfully"));
});

// Update user settings
const updateSettings = asyncHandler(async (req, res) => {
  const updates = req.body;
  
  const user = await User.findByIdAndUpdate(
    req.user?._id,
    {
      $set: {
        "settings": {
          ...req.user.settings,
          ...updates
        }
      }
    },
    { new: true }
  ).select("settings");

  if (!user) {
    throw new ApiError(404, "User not found");
  }

  return res
    .status(200)
    .json(new ApiResponse(200, user.settings, "Settings updated successfully"));
});

// Reset settings to default
const resetSettings = asyncHandler(async (req, res) => {
  const defaultSettings = {
    profileVisibility: 'public',
    showSubscriptions: true,
    showLikedVideos: true,
    allowComments: true,
    allowMentions: true,
    emailNotifications: true,
    commentNotifications: true,
    subscriptionNotifications: true,
    systemAnnouncements: true
  };

  const user = await User.findByIdAndUpdate(
    req.user?._id,
    { $set: { settings: defaultSettings } },
    { new: true }
  ).select("settings");

  if (!user) {
    throw new ApiError(404, "User not found");
  }

  return res
    .status(200)
    .json(new ApiResponse(200, user.settings, "Settings reset successfully"));
});

export {
  getSettings,
  updateSettings,
  resetSettings
};