# Mutation Payload Reference

This file is the request-body contract reference for POST/PATCH endpoints.

## Users

### `POST /users/register`

```json
{
  "fullName": "string, required",
  "email": "string email, required",
  "username": "string, required",
  "password": "string, required"
}
```

### `POST /users/verify-email`

```json
{
  "identifier": "email or username, required",
  "otp": "6-digit string, required"
}
```

### `POST /users/resend-otp`

```json
{
  "identifier": "email or username, required"
}
```

### `POST /users/login`

```json
{
  "email": "string, optional if username provided",
  "username": "string, optional if email provided",
  "password": "string, required"
}
```

### `POST /users/refresh-token`

```json
{
  "refreshToken": "string, optional if refreshToken cookie exists"
}
```

### `POST /users/change-password`

```json
{
  "oldPassword": "string, required",
  "newPassword": "string, required"
}
```

### `POST /users/forgot-password`

```json
{
  "email": "string email, required"
}
```

### `POST /users/forgot-password/verify`

```json
{
  "email": "string email, required",
  "otp": "6-digit string, required"
}
```

### `POST /users/reset-password`

```json
{
  "email": "string email, required",
  "newPassword": "string, required",
  "otp": "6-digit string, optional fallback path",
  "resetToken": "string, optional if cookie-based reset token missing"
}
```

### `PATCH /users/update-account`

```json
{
  "fullName": "string, required"
}
```

### `PATCH /users/update-avatar`

```json
{
  "avatarPublicId": "cloudinary public id, required"
}
```

### `PATCH /users/update-coverImage`

```json
{
  "coverImagePublicId": "cloudinary public id, required"
}
```

### `PATCH /users/update-description`

```json
{
  "channelDescription": "string, optional",
  "channelLinks": ["string URL", "optional"]
}
```

### `POST /users/switch-account`

```json
{
  "accountSwitchToken": "string, required"
}
```

### `POST /users/switch-account/resolve`

```json
{
  "tokens": ["string accountSwitchToken", "max 10"]
}
```

### `PATCH /users/restore-account/request`

```json
{
  "email": "string, optional if username sent",
  "username": "string, optional if email sent"
}
```

### `PATCH /users/restore-account/confirm`

```json
{
  "email": "string, optional if username sent",
  "username": "string, optional if email sent",
  "otp": "6-digit string, required"
}
```

### `POST /users/change-email/request`

```json
{
  "email": "new email, required"
}
```

### `POST /users/change-email/confirm`

```json
{
  "otp": "6-digit string, required"
}
```

## Upload and Media

### `POST /upload/session`

```json
{
  "fileName": "string, required",
  "fileSize": "number bytes, required",
  "mimeType": "string starting video/ or image/, required",
  "uploadType": "video|image|avatar|cover|post|tweet|thumbnail, optional"
}
```

### `PATCH /upload/progress/:sessionId`

```json
{
  "uploadedBytes": "number or bigint-compatible value, required"
}
```

### `POST /upload/finalize/:sessionId`

```json
{
  "title": "string, required, max 120",
  "description": "string, required, max 5000",
  "publicId": "cloudinary video public id, required",
  "thumbnailPublicId": "cloudinary image public id, required",
  "duration": "number seconds, optional",
  "width": "number, optional",
  "height": "number, optional",
  "isShort": "boolean, optional",
  "tags": ["string tag", "optional, max 20"],
  "categoryId": "string, optional",
  "categoryIds": ["string", "optional"],
  "category": "string, optional",
  "categories": ["string/object", "optional"],
  "categorySlug": "string, optional",
  "categorySlugs": ["string", "optional"],
  "transcript": "string, optional",
  "transcriptText": "string alias, optional",
  "transcriptCues": [{ "startMs": 0, "endMs": 0, "text": "string" }],
  "cues": "alias of transcriptCues",
  "segments": "alias of transcriptCues",
  "transcriptLanguage": "string, optional",
  "language": "alias, optional",
  "transcriptSource": "MANUAL|AUTO|IMPORTED, optional",
  "source": "alias, optional"
}
```

### `POST /media/finalize/:sessionId`

```json
{
  "uploadType": "avatar|coverImage, required",
  "publicId": "cloudinary image public id, required"
}
```

## Videos / Watch

### `PATCH /videos/:videoId`

```json
{
  "title": "string, optional",
  "description": "string, optional"
}
```

## Comments

### `POST /comments/:videoId`
### `PATCH /comments/c/:commentId`

```json
{
  "content": "string, required, max 1000"
}
```

## Subscriptions

### `PATCH /subscriptions/c/:channelId/notifications`

```json
{
  "level": "ALL|PERSONALIZED|NONE, required"
}
```

## Playlists

### `POST /playlists`

```json
{
  "name": "string, required, max 100",
  "description": "string, optional, max 1000",
  "isPublic": "boolean, optional"
}
```

### `PATCH /playlists/:playlistId`

```json
{
  "name": "string, optional",
  "description": "string, optional"
}
```

## Tweets

### `POST /tweets`

```json
{
  "content": "string, required, max 500",
  "imagePublicId": "string, optional"
}
```

### `PATCH /tweets/:tweetId`

```json
{
  "content": "string, required, max 500"
}
```

## Watch History

### `POST /watch-history`

```json
{
  "videoId": "string, required",
  "progress": "number 0-100, required",
  "duration": "number seconds, optional"
}
```

### `POST /watch-history/bulk`

```json
{
  "videoIds": ["string video id", "max 100 used"]
}
```

## Settings

### `PATCH /settings`

```json
{
  "profileVisibility": "PUBLIC|PRIVATE",
  "showSubscriptions": "boolean",
  "showLikedVideos": "boolean",
  "allowComments": "boolean",
  "allowMentions": "boolean",
  "emailNotifications": "boolean",
  "commentNotifications": "boolean",
  "subscriptionNotifications": "boolean",
  "systemAnnouncements": "boolean",
  "autoplayNext": "boolean",
  "defaultPlaybackSpeed": "number between 0.25 and 3",
  "saveWatchHistory": "boolean",
  "showProgressBar": "boolean",
  "showViewCount": "boolean",
  "showVideoDuration": "boolean",
  "showChannelName": "boolean",
  "personalizeRecommendations": "boolean",
  "showTrending": "boolean",
  "hideShorts": "boolean"
}
```

## Feedback

### `POST /feedback/not-interested/:videoId`

```json
{
  "reason": "string, optional, max 300"
}
```

### `POST /feedback/reports`

```json
{
  "targetType": "VIDEO|COMMENT|USER|CHANNEL, required",
  "targetId": "string, required",
  "reason": "string, required, max 120",
  "description": "string, optional, max 2000"
}
```

## AI

### `POST /ai/sessions`

```json
{
  "videoId": "string, optional",
  "title": "string, optional, max 120"
}
```

### `PATCH /ai/sessions/:sessionId`

```json
{
  "title": "string, required, max 120"
}
```

### `POST /ai/sessions/:sessionId/messages`

```json
{
  "message": "string, required, max 1500"
}
```

### `POST /ai/videos/:videoId/summary`

```json
{
  "force": "boolean, optional"
}
```

### `POST /ai/videos/:videoId/ask`

```json
{
  "question": "string, required, max 1500"
}
```

### `POST /ai/videos/:videoId/transcript`

```json
{
  "transcript": "string, optional",
  "cues": [{ "startMs": 0, "endMs": 0, "text": "string" }],
  "segments": "alias of cues",
  "transcriptCues": "alias of cues",
  "language": "string, optional",
  "source": "MANUAL|AUTO|IMPORTED, optional"
}
```

## Admin

### Common moderation body

```json
{
  "reason": "string, optional, max 500"
}
```

### `PATCH /admin/users/:userId/status`

```json
{
  "status": "ACTIVE|RESTRICTED|SUSPENDED, required",
  "reason": "string, optional"
}
```

### `PATCH /admin/users/:userId/role`

```json
{
  "role": "USER|MODERATOR|ADMIN|SUPER_ADMIN, required",
  "reason": "string, optional"
}
```

### `PATCH /admin/reports/:reportId/resolve`

```json
{
  "status": "REVIEWED|REJECTED|ACTION_TAKEN, required",
  "note": "string, optional, max 2000",
  "action": "string action type or object action descriptor, optional"
}
```
