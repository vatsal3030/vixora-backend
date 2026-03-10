# Frontend API Contract (Full In-Depth)

Last updated: 2026-03-01
Source of truth: `src/app.js`, `src/routes/*`, `src/controllers/*`, `src/utils/*`, `src/middlewares/*`, `prisma/schema.prisma`

This file is the single integration contract for frontend engineers and frontend AI agents.

Use this file when building:
- web app screens
- admin panel screens
- API service layer
- AI chat UI bindings
- upload/Cloudinary flows

If a conflict exists between old docs and this file, follow this file and backend source code.

---

## 1) Global API Rules

### 1.1 Base URLs
- Main API base: `/api/v1`
- Health endpoint: `GET /healthz`
- Root status endpoint: `GET /`

### 1.2 Auth transport
Protected endpoints accept either:
- `HttpOnly` cookie: `accessToken`
- `Authorization: Bearer <accessToken>`

Frontend must always send credentials:
- `fetch`: `credentials: "include"`
- Axios: `withCredentials: true`

### 1.3 Standard success envelope
Most endpoints return:

```json
{
  "statusCode": 200,
  "data": {},
  "message": "Success",
  "success": true
}
```

Notes:
- Always parse payload from `response.data.data`.
- `GET /healthz` and `GET /` are plain JSON (not `ApiResponse`).

### 1.4 Standard error envelope

```json
{
  "success": false,
  "message": "..."
}
```

Some auth failures are returned directly (not wrapped in `ApiResponse`), but always include `success=false` + `message`.

### 1.5 Standard list envelope
All paginated list endpoints use:

```json
{
  "items": [],
  "pagination": {
    "currentPage": 1,
    "page": 1,
    "itemsPerPage": 10,
    "limit": 10,
    "totalItems": 0,
    "total": 0,
    "totalPages": 0,
    "hasPrevPage": false,
    "hasNextPage": false
  }
}
```

Use `data.items` as canonical array.

### 1.6 Pagination field purpose
- `currentPage` and `page`: same value (`page` is legacy alias)
- `itemsPerPage` and `limit`: same value (`limit` is legacy alias)
- `totalItems` and `total`: same value (`total` is legacy alias)
- `totalPages`: number of pages
- `hasPrevPage`, `hasNextPage`: pagination navigation flags

---

## 2) Shared Data Object Dictionary

These object names are not backend type names; they are integration names for frontend contracts.

## 2.1 `UserPublic`
Used in many responses.

Fields:
- `id`: user UUID
- `username`: channel handle
- `email`: user email (only in auth/profile contexts)
- `fullName`: display name
- `avatar`: avatar URL
- `coverImage`: cover URL
- `channelDescription`: about text
- `channelLinks`: array/object of links
- `role`: `USER|MODERATOR|ADMIN|SUPER_ADMIN`
- `moderationStatus`: `ACTIVE|RESTRICTED|SUSPENDED`
- `isDeleted`: soft-delete flag
- `emailVerified`: account verified flag

## 2.2 `AccountSwitchPayload`
Returned by login/refresh and account-switch endpoints.

Fields:
- `accountSwitchToken`: secure token to switch without logging out
- `account`: compact profile for account switcher UI

## 2.3 `UploadSession`
Returned by upload session APIs.

Fields:
- `id`: upload session id
- `userId`: owner id
- `status`: `INITIATED|UPLOADING|PROCESSING|COMPLETED|FAILED`
- `uploadType`: `VIDEO|IMAGE|AVATAR|COVER_IMAGE|POST|TWEET|THUMBNAIL`
- `totalSize`: total bytes as string
- `uploadedSize`: uploaded bytes as string
- `createdAt`, `updatedAt`, `cancelledAt`
- `videoId`: set after video finalize

## 2.4 `CloudinarySignaturePayload`
Returned by signature endpoint.

Fields:
- `timestamp`: unix seconds
- `signature`: Cloudinary upload signature
- `publicId`: signed public id path
- `cloudName`: Cloudinary cloud name
- `api_key`: Cloudinary API key
- `resourceType`: requested type (`video`, `thumbnail`, etc.)

## 2.5 `VideoCard`
Used in feed/search/list UIs.

Fields (may vary by endpoint):
- `id`
- `title`
- `thumbnail`
- `duration`
- `views`
- `isShort`
- `createdAt`
- `owner`: usually contains `id`, `username`, `fullName`, `avatar`
- `tags`: string[] (where included)

## 2.6 `VideoDetail`
Used by `/videos/:videoId` and `/watch/:videoId` with extra streaming fields.

Core fields:
- `id`, `title`, `description`, `duration`, `views`, `isShort`
- media: `videoFile`, `playbackUrl`, `masterPlaylistUrl`, `thumbnail`
- quality: `availableQualities`, `selectedQuality`, `qualityUrls`
- processing: `processingStatus`, `processingProgress`, `processingStep`, `processingError`
- owner info and engagement counts

## 2.7 `StreamingPayload`
Used by `/watch/:videoId/stream` and included in watch/detail responses.

Fields:
- `selectedQuality`: resolved quality for current request
- `defaultQuality`: backend default selection
- `selectedPlaybackUrl`: URL to play now
- `masterPlaylistUrl`: master playback URL
- `availableQualities`: quality options (contains `AUTO`/`MAX` when available)
- `qualityUrls`: map of quality -> URL

## 2.8 `TranscriptSegment`
Used in transcript APIs.

Fields:
- `index`: sequence index
- `startMs`, `endMs`
- `startSeconds`, `endSeconds`
- `text`

## 2.9 `AiSession`
Returned by AI session list/create.

Fields:
- `id`
- `userId`
- `videoId` (nullable)
- `title`
- `createdAt`, `updatedAt`
- `messageCount`
- `lastMessage` (`AiMessage` or null)
- `video`: `{ id, title, thumbnail }` or null

## 2.10 `AiMessage`
Returned in AI chat endpoints.

Fields:
- `id`
- `role`: `SYSTEM|USER|ASSISTANT`
- `roleLower`: normalized helper (`system|user|assistant`)
- `content`
- `text` (alias of content)
- `message` (alias of content)
- `tokensUsed`
- `createdAt`

## 2.11 `AiMeta`
Returned by AI summary/chat/ask endpoints under `data.ai`.

Fields:
- `provider`: `gemini|fallback|rule-based|session-cache`
- `model`: selected model or `none`
- `warning`: provider warning if any
- `quota`: quota snapshot (`usedToday`, `dailyLimit`, etc.)
- `confidence`: normalized confidence number
- `citations`: context sources used by backend

## 2.12 `NotificationItem`
Used by notification list APIs.

Fields (typical):
- `id`
- `title`, `message`
- `type`: `COMMENT|LIKE|SUBSCRIPTION|UPLOAD|MENTION|SYSTEM`
- `isRead`
- `senderId`, `videoId`
- `data`: metadata object
- `createdAt`

## 2.13 `AdminAuditLog`
Used in admin audit APIs.

Fields:
- `id`
- `actorId`, `actorRole`
- `action`
- `targetType`, `targetId`
- `reason`
- `before`, `after`, `metadata`
- `ip`, `userAgent`
- `createdAt`

---

## 3) System + Health

## 3.1 `GET /healthz`
Purpose: infra liveness.
Response:

```json
{ "status": "ok" }
```

## 3.2 `GET /`
Purpose: backend online marker.
Response:

```json
{
  "success": true,
  "message": "Vixora Backend is running",
  "version": "1.0.0"
}
```

---

## 4) OAuth (`/api/v1/auth`)

## 4.1 `GET /auth/google`
Purpose: start Google OAuth login flow.
Auth: no.
Frontend use: browser redirect (`window.location.href`).

## 4.2 `GET /auth/google/callback`
Purpose: OAuth callback from Google.
Behavior:
- verifies state cookie
- creates/links account
- sets auth cookies
- redirects to frontend URL

---

## 5) Users + Auth (`/api/v1/users`)

## 5.1 `POST /users/register`
Purpose: create local account and send verification OTP.
Body:
- `fullName` (required)
- `email` (required)
- `username` (required)
- `password` (required)

Response `data`:
- lightweight account creation result (no full login)

## 5.2 `POST /users/verify-email`
Purpose: verify OTP and activate email.
Body:
- `identifier` (email or username)
- `otp`

Response:
- `{}` with message "Email verified successfully"

## 5.3 `POST /users/resend-otp`
Purpose: resend registration OTP.
Body:
- `identifier`

## 5.4 `POST /users/login`
Purpose: login and issue cookie tokens.
Body:
- `email` or `username`
- `password`

Response `data`:
- `user: UserPublic`
- `accountSwitch: AccountSwitchPayload`

## 5.5 `POST /users/logout` (auth)
Purpose: clear tokens.
Response: empty object.

## 5.6 `POST /users/refresh-token`
Purpose: rotate access/refresh tokens.
Input:
- cookie `refreshToken` preferred
- optional body fallback `{ refreshToken }`

Response `data`:
- `user: UserPublic`
- `accountSwitch: AccountSwitchPayload`

## 5.7 `GET /users/current-user` (auth)
Purpose: hydrate current session user.
Response `data`: `UserPublic`.

## 5.8 Forgot password flow

### 5.8.1 `POST /users/forgot-password`
Body:
- `email`
Purpose: send OTP for reset.

### 5.8.2 `POST /users/forgot-password/verify`
Body:
- `email`
- `otp`
Purpose:
- verify OTP
- issue password-reset token cookie (`passwordResetToken`)

### 5.8.3 `POST /users/reset-password`
Body:
- `email`
- `newPassword`
- optional `resetToken` fallback (cookie-first flow recommended)

Legacy compatibility:
- OTP body fallback still accepted for older clients, but do not build new UI with it.

## 5.9 `POST /users/change-password` (auth)
Body:
- `oldPassword`
- `newPassword`

## 5.10 Account profile update endpoints (auth)
- `PATCH /users/update-account` -> body `{ fullName }`
- `PATCH /users/update-description` -> body `{ channelDescription?, channelLinks? }`
- `PATCH /users/update-avatar` -> body `{ avatarPublicId }`
- `PATCH /users/update-coverImage` -> body `{ coverImagePublicId }`

Avatar/Cover contract:
- send Cloudinary `publicId` only
- backend verifies folder ownership and derives trusted URL

## 5.11 Public profile read endpoints (auth required in current backend)
- `GET /users/u/:username`
- `GET /users/id/:userId`

## 5.12 Account deletion + restore
- `DELETE /users/delete-account` (soft delete)
- `PATCH /users/restore-account/request` body `{ email? OR username? }`
- `PATCH /users/restore-account/confirm` body `{ email? OR username?, otp }`

Restore window policy:
- 7 days from deletion.

## 5.13 Email change flow (auth)
- `POST /users/change-email/request` body `{ email }`
- `POST /users/change-email/confirm` body `{ otp }`
- `POST /users/change-email/cancel`

## 5.14 Multi-account switch (auth)
- `GET /users/account-switch-token`
- `POST /users/switch-account` body `{ accountSwitchToken }`
- `POST /users/switch-account/resolve` body `{ tokens: string[] }`

Purpose:
- switch between previously signed-in accounts without logout/login loop.

---

## 6) Upload + Media

## 6.1 Upload session (`/api/v1/upload`)

### 6.1.1 `POST /upload/session` (auth)
Body:
- `fileName` required
- `fileSize` required
- `mimeType` required (`video/*` or `image/*`)
- `uploadType` optional (`VIDEO|IMAGE|AVATAR|COVER_IMAGE|POST|TWEET|THUMBNAIL`)

Response `data`: `UploadSession`.

### 6.1.2 `PATCH /upload/session/:sessionId/cancel`
Purpose: cancel active session.

### 6.1.3 `GET /upload/signature?resourceType=...`
Allowed `resourceType`:
- `video`
- `thumbnail`
- `avatar`
- `cover` or `coverimage`
- `post`
- `tweet`

Response `data`: `CloudinarySignaturePayload`.

Folder mapping:
- `video` -> `videos/<userId>`
- `thumbnail` -> `thumbnails/<userId>`
- `avatar` -> `avatars/<userId>`
- `cover|coverimage` -> `covers/<userId>`
- `post|tweet` -> `tweets/<userId>`

### 6.1.4 `PATCH /upload/progress/:sessionId`
Body:
- `uploadedBytes` (number or numeric string)

Response `data`:
- updated session fields
- `progressPercent`

Important:
- backend clamps multipart overhead and prevents regressions.

### 6.1.5 `POST /upload/finalize/:sessionId`
Purpose: create video record and start processing.
Body required:
- `title`
- `description`
- `publicId` (video Cloudinary public id)
- `thumbnailPublicId`

Body optional:
- `duration`, `width`, `height`
- `isShort` (`true|false`)
- `tags` (array or comma string)
- transcript inputs:
  - `transcript` / `transcriptText`
  - `transcriptCues` / `cues` / `segments`
  - `transcriptLanguage` / `language`
  - `transcriptSource` / `source` (`MANUAL|AUTO|IMPORTED`)

Response `data`:
- created video row (`processingStatus` starts as `PENDING`)

Backend behavior:
- verifies Cloudinary ownership via Admin API
- stores trusted `secure_url` only
- normalizes quality profile and playback fields
- enqueues queue job; falls back to direct processing if queue unavailable

## 6.2 Media finalize (`/api/v1/media`)

### 6.2.1 `POST /media/finalize/:sessionId` (auth)
Body:
- `uploadType`: `avatar|coverImage`
- `publicId`

Purpose:
- session-based avatar/cover finalize flow.

### 6.2.2 `DELETE /media/:type` (auth)
Path:
- `type=avatar|coverImage`

Purpose:
- remove profile image reference (and cleanup logic).

---

## 7) Videos (`/api/v1/videos`, all auth)

## 7.1 List/read
- `GET /videos` -> query `page,limit,query,sortBy,sortType,isShort,tags`
- `GET /videos/me` -> same as above, current owner focus
- `GET /videos/user/:userId` -> creator profile list
- `GET /videos/trash/me` -> soft-deleted videos
- `GET /videos/:videoId` -> detailed video payload, supports `quality` query

`quality` accepted values:
- `auto|max|1080p|720p|480p|360p|240p|144p`

## 7.2 Processing lifecycle
- `GET /videos/:videoId/processing-status`
- `PATCH /videos/:videoId/cancel-processing`

## 7.3 Publish/restore/edit/delete
- `PATCH /videos/:videoId/publish`
- `PATCH /videos/:videoId/restore`
- `PATCH /videos/:videoId` body `{ title?, description? }`
- `DELETE /videos/:videoId` (soft delete)

Purpose notes:
- delete is soft-delete, restore respects policy window.
- owner should still be able to view unpublished own video through owner routes.

---

## 8) Public watch (`/api/v1/watch`)

## 8.1 `GET /watch/:videoId`
Purpose:
- public watch payload
- increments views for non-owner

Query:
- `quality` optional

Response includes:
- `playbackUrl`
- `selectedQuality`
- `availableQualities`
- `qualityUrls`
- `streaming` object

## 8.2 `GET /watch/:videoId/stream`
Purpose: stream metadata + quality switch helper without view increment.

## 8.3 `GET /watch/:videoId/transcript`
Query:
- text filter: `q`
- range: `from`, `to` (timestamp string) or `fromSeconds`, `toSeconds`
- paging: `page`, `limit` (default 50, max 200)

Response data includes:
- transcript metadata
- `items: TranscriptSegment[]`
- pagination

---

## 9) Feed (`/api/v1/feed`)

- `GET /feed/home` (auth)
- `GET /feed/subscriptions` (auth)
- `GET /feed/trending` (optional auth)
- `GET /feed/shorts` (optional auth)

Common query:
- `page`, `limit`
- `sortBy`, `sortType` where supported
- `isShort` where supported

Shorts-specific query:
- `includeComments=true|false`
- `commentsLimit` (max 10)

Backend strategy:
- ranked items + diversity mixing
- suppression of not-interested videos
- suppression of blocked channels
- caching by scope/query for free-tier efficiency

Response:
- normalized list payload (`items`, `pagination`)

---

## 10) Public search (`/api/v1/search`)

## 10.1 `GET /search`
Query:
- `q`
- `scope` (alias `type`): `all|videos|channels|tweets|playlists`
- `tags` (csv)
- `category`
- `channelCategory` (alias for category)
- `sortBy`, `sortType`

For `scope=all`:
- optional `perTypeLimit` (default 5, max 15)

For typed scope:
- `page`, `limit`

Response for `scope=all`:
- `scope`, `query`, `filters`, `limits`
- `results`: grouped arrays (`videos`, `channels`, `tweets`, `playlists`)
- `totals` per type

Response for typed scope:
- standard list envelope with `items/pagination`
- plus `scope`, `query`, `filters`

Indexing/visibility rules:
- videos: published + completed + non-deleted + non-deleted owner
- channels: non-deleted
- playlists: public + non-deleted
- tweets: non-deleted

---

## 11) AI (`/api/v1/ai`, auth)

## 11.1 Sessions
- `POST /ai/sessions` body `{ videoId?, title? }`
- `GET /ai/sessions?page&limit`
- `DELETE /ai/sessions` (optional query `videoId` for scoped clear)
- `PATCH /ai/sessions/:sessionId` body `{ title }`
- `DELETE /ai/sessions/:sessionId`

## 11.2 Messages
- `GET /ai/sessions/:sessionId/messages?page&limit`
- `POST /ai/sessions/:sessionId/messages` body `{ message }`
- `DELETE /ai/sessions/:sessionId/messages?keepSystem=true|false`
- `DELETE /ai/sessions/:sessionId/messages/:messageId?cascade=true|false`

Send-message response (`data`) exact contract:
- `sessionId`
- `userMessage: AiMessage`
- `assistantMessage: AiMessage`
- `reply` (assistant text)
- `answer` (alias of `reply`)
- `context`:
  - `hasTranscript`
  - `transcriptChars`
  - `hasDescription`
  - `hasSummary`
  - `quality` (`RICH|LIMITED|MINIMAL`)
- `ai: AiMeta`

Provider behavior:
- `rule-based` for greetings/context-source small-talk
- `session-cache` when exact recent user question repeats
- `gemini` when provider configured and usable
- `fallback` when provider unavailable/error

## 11.3 Video summary and Q&A
- `GET /ai/videos/:videoId/summary`
- `POST /ai/videos/:videoId/summary` body `{ force? }`
- `POST /ai/videos/:videoId/ask` body `{ question }`

Q&A response includes both `answer` and `reply`. Use either; they are equal.

## 11.4 Video transcript AI endpoints
- `GET /ai/videos/:videoId/transcript`
- `POST /ai/videos/:videoId/transcript` (owner only)
- `DELETE /ai/videos/:videoId/transcript` (owner only)

Accepted transcript inputs in POST:
- plain text: `transcript`
- timed text arrays: `cues` or `segments` or `transcriptCues`
- optional `language`
- optional `source` (`MANUAL|AUTO|IMPORTED`)

Daily limits:
- user-level daily message cap from `AI_DAILY_MESSAGE_LIMIT`
- optional global cap from `AI_GLOBAL_DAILY_MESSAGE_LIMIT`

---

## 12) Feedback + reports (`/api/v1/feedback`, auth)

- `GET /feedback/not-interested?page&limit`
- `POST /feedback/not-interested/:videoId` body `{ reason? }`
- `DELETE /feedback/not-interested/:videoId`

- `GET /feedback/blocked-channels?page&limit`
- `POST /feedback/blocked-channels/:channelId`
- `DELETE /feedback/blocked-channels/:channelId`

- `POST /feedback/reports` body:
  - `targetType`: `VIDEO|COMMENT|USER|CHANNEL`
  - `targetId`
  - `reason`
  - `description?`

- `GET /feedback/reports/me?page&limit`

Purpose:
- recommendation suppression controls
- user reporting funnel into admin moderation.

---

## 13) Comments (`/api/v1/comments`)

- `GET /comments/:videoId` (optional auth) query `page,limit,sortType`
- `POST /comments/:videoId` (auth) body `{ content }`
- `PATCH /comments/c/:commentId` (auth) body `{ content }`
- `DELETE /comments/c/:commentId` (auth)

Response:
- lists use normalized list format
- mutate endpoints return created/updated object or `{}` for deletes

---

## 14) Likes (`/api/v1/likes`, auth)

- `POST /likes/toggle/v/:videoId`
- `POST /likes/toggle/c/:commentId`
- `POST /likes/toggle/t/:tweetId`
- `GET /likes/videos`

Toggle response `data`:
- `{ "status": "liked" }` or `{ "status": "unliked" }`

---

## 15) Subscriptions (`/api/v1/subscriptions`, auth)

- `GET /subscriptions` (subscribed feed list)
- `POST /subscriptions/c/:channelId/subscribe` (toggle)
- `GET /subscriptions/c/:channelId/subscribers/count`
- `GET /subscriptions/u/subscriptions`
- `PATCH /subscriptions/c/:channelId/notifications` body `{ level }`
- `GET /subscriptions/c/:channelId/status`

`level` enum:
- `ALL|PERSONALIZED|NONE`

---

## 16) Channels (`/api/v1/channels`)

- `GET /channels/:channelId` (optional auth)
- `GET /channels/:channelId/about` (optional auth)
- `GET /channels/:channelId/videos`
- `GET /channels/:channelId/shorts`
- `GET /channels/:channelId/playlists`
- `GET /channels/:channelId/tweets`

Default limits:
- videos: 20
- shorts: 30
- playlists: 50
- tweets: 20

Channel info/about responses include:
- profile/about fields
- stats for youtube-like channel header:
  - `subscribersCount`
  - `totalViews`
  - `totalLikes`
  - `totalComments`
  - `videosCount`
  - `shortsCount`
  - `playlistsCount`
  - `tweetsCount`
  - `joinedAt`

List endpoints return normalized `items/pagination` only (no duplicate alias arrays).

---

## 17) Playlists (`/api/v1/playlists`, auth)

Watch-later:
- `POST /playlists/watch-later/:videoId`
- `GET /playlists/watch-later?page&limit`

Playlist CRUD:
- `POST /playlists` body `{ name, description?, isPublic? }`
- `GET /playlists/user/me`
- `GET /playlists/user/:userId`
- `GET /playlists/:playlistId`
- `PATCH /playlists/:playlistId` body `{ name?, description? }`
- `DELETE /playlists/:playlistId` (soft delete)

Trash/restore:
- `GET /playlists/trash/me`
- `PATCH /playlists/:playlistId/restore`

Video mapping:
- `PATCH /playlists/add/:videoId/:playlistId`
- `PATCH /playlists/remove/:videoId/:playlistId`

Visibility:
- `PATCH /playlists/:playlistId/toggle-visibility`

---

## 18) Tweets (`/api/v1/tweets`, auth)

- `POST /tweets` body `{ content, imagePublicId? }`
- `GET /tweets/user/:userId`
- `GET /tweets/trash/me`
- `PATCH /tweets/:tweetId/restore`
- `GET /tweets/:tweetId`
- `PATCH /tweets/:tweetId` body `{ content }`
- `DELETE /tweets/:tweetId`

---

## 19) Notifications (`/api/v1/notifications`, auth)

- `GET /notifications`
- `GET /notifications/unread-count`
- `GET /notifications/unread`
- `PATCH /notifications/:notificationId/read`
- `PATCH /notifications/read-all`
- `DELETE /notifications/:notificationId`
- `DELETE /notifications`

Supported filters:
- `page`, `limit`
- `sortBy`: `createdAt|time|type|isRead`
- `sortType`: `asc|desc`
- `isRead` (only for full list)
- `type`
- `channelId`
- `q`
- `from`, `to`

### 19.1 Realtime notification event
Socket event: `notification:new`
Payload contains:
- `title`, `message`, `type`, `senderId`, `videoId`, `data`, `createdAt`, `requiresSync`

Frontend behavior on event:
1. refresh `/notifications/unread-count`
2. refresh `/notifications` list if dropdown/panel open

---

## 20) Dashboard (`/api/v1/dashboard`, auth)

- `GET /dashboard/full`
- `GET /dashboard/overview`
- `GET /dashboard/analytics`
- `GET /dashboard/top-videos`
- `GET /dashboard/growth`
- `GET /dashboard/insights`

Periods:
- `7d|30d|90d|1y`

`/full` returns one-call payload:
- `period`
- `generatedAt`
- `overview`
- `analytics`
- `topVideos`
- `growth`
- `insights`

Use `/full` for dashboard page first render to reduce frontend waterfall requests.

---

## 21) Settings (`/api/v1/settings`, auth)

- `GET /settings`
- `PATCH /settings` (partial update)
- `POST /settings/reset`

Allowed patch fields:
- `profileVisibility` (`PUBLIC|PRIVATE`)
- `showSubscriptions`
- `showLikedVideos`
- `allowComments`
- `allowMentions`
- `emailNotifications`
- `commentNotifications`
- `subscriptionNotifications`
- `systemAnnouncements`
- `autoplayNext`
- `defaultPlaybackSpeed` (`0.25` to `3`)
- `saveWatchHistory`
- `showProgressBar`
- `showViewCount`
- `showVideoDuration`
- `showChannelName`
- `personalizeRecommendations`
- `showTrending`
- `hideShorts`

---

## 22) Watch history (`/api/v1/watch-history`, auth)

- `GET /watch-history`
- `POST /watch-history` body `{ videoId, progress, duration }`
- `GET /watch-history/:videoId`
- `DELETE /watch-history/:videoId`
- `DELETE /watch-history?completedOnly=true|false`
- `POST /watch-history/bulk` body `{ videoIds: string[] }`

Query options for list:
- `page`, `limit`, `query`, `isShort`, `includeCompleted`, `sortBy`, `sortType`

Purpose:
- continue watching rows
- per-video progress map for cards/grids
- user controls to remove single/all history

---

## 23) Internal ops (`/api/v1/internal`)

## 23.1 `GET /internal/usage`
Purpose: backend metrics snapshot.
Auth:
- internal token header (`x-internal-token`) or equivalent configured authorization.

Do not call from normal product traffic.

---

## 24) Admin APIs (`/api/v1/admin`)

Middleware stack:
1. `verifyJwt`
2. `ensureAdminPanelEnabled`
3. `verifyAdmin`

Admin panel feature flag:
- `ADMIN_PANEL_ENABLED=true` to expose admin routes

Role matrix:
- `MODERATOR`: report/content moderation, set user status `ACTIVE|RESTRICTED`
- `ADMIN`: moderator + suspend users + soft-delete/restore user + verify pending email
- `SUPER_ADMIN`: admin + role management

Safety guard:
- last remaining `SUPER_ADMIN` cannot be demoted.

## 24.1 Session/profile
- `GET /admin/me`

## 24.2 Dashboard
- `GET /admin/dashboard/overview?period=7d|30d|90d|1y`
- `GET /admin/dashboard/activity?period=7d|30d|90d|1y`

## 24.3 Reports
- `GET /admin/reports`
- `GET /admin/reports/:reportId`
- `PATCH /admin/reports/:reportId/resolve`

Resolve body:

```json
{
  "status": "REVIEWED",
  "note": "checked",
  "action": {
    "type": "VIDEO_UNPUBLISH",
    "targetType": "VIDEO",
    "targetId": "video_uuid",
    "payload": { "reason": "policy violation" }
  }
}
```

Allowed statuses:
- `REVIEWED|REJECTED|ACTION_TAKEN`

Supported action types:
- `USER_SET_STATUS`
- `USER_SOFT_DELETE`
- `USER_RESTORE`
- `USER_VERIFY_PENDING_EMAIL`
- `VIDEO_UNPUBLISH`
- `VIDEO_PUBLISH`
- `VIDEO_SOFT_DELETE`
- `VIDEO_RESTORE`
- `TWEET_SOFT_DELETE`
- `TWEET_RESTORE`
- `COMMENT_SOFT_DELETE`
- `COMMENT_RESTORE`
- `PLAYLIST_SOFT_DELETE`
- `PLAYLIST_RESTORE`

## 24.4 Users moderation
- `GET /admin/users`
- `GET /admin/users/:userId`
- `PATCH /admin/users/:userId/status` body `{ status, reason }`
- `PATCH /admin/users/:userId/verify-pending-email` body `{ reason? }`
- `PATCH /admin/users/:userId/soft-delete` body `{ reason }`
- `PATCH /admin/users/:userId/restore` body `{ reason? }`
- `PATCH /admin/users/:userId/role` body `{ role, reason? }` (SUPER_ADMIN only)

## 24.5 Videos moderation
- `GET /admin/videos`
- `GET /admin/videos/:videoId`
- `PATCH /admin/videos/:videoId/unpublish`
- `PATCH /admin/videos/:videoId/publish`
- `PATCH /admin/videos/:videoId/soft-delete`
- `PATCH /admin/videos/:videoId/restore`

## 24.6 Tweets moderation
- `GET /admin/tweets`
- `GET /admin/tweets/:tweetId`
- `PATCH /admin/tweets/:tweetId/soft-delete`
- `PATCH /admin/tweets/:tweetId/restore`

## 24.7 Comments moderation
- `GET /admin/comments`
- `GET /admin/comments/:commentId`
- `PATCH /admin/comments/:commentId/soft-delete`
- `PATCH /admin/comments/:commentId/restore`

## 24.8 Playlists moderation
- `GET /admin/playlists`
- `GET /admin/playlists/:playlistId`
- `PATCH /admin/playlists/:playlistId/soft-delete`
- `PATCH /admin/playlists/:playlistId/restore`

## 24.9 Audit logs
- `GET /admin/audit-logs`
- `GET /admin/audit-logs/:logId`

Admin policy:
- admin delete actions are soft-delete only
- restore window is 7 days
- all admin mutations are audit-logged

---

## 25) Backend strategy notes frontend must know

## 25.1 Read-only moderation guard
For non-admin users with `moderationStatus=RESTRICTED|SUSPENDED`:
- GET/read routes continue to work
- write/mutation routes return 403 except safe auth/account-switch writes

Frontend implication:
- if write fails with restriction message, keep app usable in read-only mode.

## 25.2 Caching strategy
Cache implementation:
- L1 in-memory cache always available when `CACHE_ENABLED=true`
- Redis cache optional and scope-limited

Key env controls:
- `CACHE_ENABLED`
- `CACHE_L1_ENABLED`
- `CACHE_DEFAULT_TTL_SECONDS`
- `CACHE_REDIS_ENABLED`
- `CACHE_REDIS_MIN_TTL_SECONDS`
- `CACHE_REDIS_SCOPE_ALLOWLIST`

Default production-safe Redis scope allowlist:
- `video:detail`
- `channel:info`
- `channel:about`

Short TTL keys can stay L1-only to reduce Redis command usage.

## 25.3 Queue + worker strategy (free-tier safe)
Queue controls:
- `QUEUE_ENABLED`
- `RUN_WORKER`
- `RUN_WORKER_ON_DEMAND`
- `WORKER_IDLE_SHUTDOWN_MS`

On-demand strategy:
- worker starts only when a processing job is enqueued
- worker auto-shuts down after idle timeout
- redis quota errors hard-disable worker for process to prevent log storms

## 25.4 Redis hard-disable behavior
When Upstash max-requests limit is hit:
- redis connection is hard-disabled for process
- queue work falls back to direct processing where implemented
- errors are cooldown-throttled in logs

Frontend implication:
- upload finalization still returns success; processing may be direct fallback.

## 25.5 Notification strategy
- persisted notifications in DB
- dedup window avoids repeated fanout spam
- websocket `notification:new` is signal; frontend should sync via API

## 25.6 AI strategy
- provider selection is dynamic
- replies can come from cached/session/rule-based/fallback
- response always includes enough metadata to display provider and context quality

---

## 26) Recommended frontend binding rules

1. Parse all payloads from `response.data.data`.
2. For lists, bind UI only from `data.items` + `data.pagination`.
3. Treat `answer` and `reply` as equivalent in AI responses.
4. Use `roleLower` for AI message bubble side mapping.
5. For quality switch, call `/watch/:videoId/stream` after first `/watch/:videoId` load.
6. For avatar/cover, always send `publicId`, never send direct URL as source of truth.
7. For restricted users, degrade to read-only UX instead of logout loop.
8. For dashboard page, prefer `/dashboard/full` for first load.
9. For notification live updates, always refetch counts/list after socket event.
10. For OAuth login, trigger browser redirect to `/auth/google`, do not XHR this route.

---

## 27) Common integration mistakes and exact fixes

1. Mistake: using wrong API base env variable in frontend.
- Fix: use one canonical env key (for example `VITE_API_BASE_URL`) and ensure production points to deployed backend domain.

2. Mistake: not sending cookies.
- Fix: `withCredentials=true` and CORS origin exactly whitelisted.

3. Mistake: expecting list aliases (`videos`, `channels`) in data.
- Fix: consume only `data.items`.

4. Mistake: sending thumbnail/video URLs to finalize upload.
- Fix: send `publicId` + `thumbnailPublicId`; backend verifies URLs itself.

5. Mistake: AI UI only reading `data.reply` but endpoint returns `data.answer` in some views.
- Fix: map fallback order `answer ?? reply ?? assistantMessage.content`.

6. Mistake: trying to use `/watch/:id/stream` as initial watch call.
- Fix: call `/watch/:id` first to get full watch payload and view handling.

7. Mistake: admin UI using normal routes for moderation.
- Fix: all moderation and report actions must use `/api/v1/admin/*`.

---

## 28) Environment values frontend should align with

Frontend runtime env typically needs:
- `VITE_API_BASE_URL=https://api.your-domain.com/api/v1`
- `VITE_FRONTEND_URL=https://app.your-domain.com`
- `VITE_GOOGLE_CLIENT_ID=<google-client-id>`

Backend CORS/env must include frontend origin(s):
- `CORS_ORIGIN=https://app.your-domain.com,https://admin.your-domain.com`
- `FRONTEND_URL=https://app.your-domain.com`
- `ADMIN_FRONTEND_URL=https://admin.your-domain.com` (if separate admin app)

---

## 29) Quick smoke test sequence for frontend AI agent

1. Auth: register -> verify-email -> login -> current-user.
2. Upload: create session -> signature -> cloudinary upload -> finalize -> processing-status -> publish.
3. Watch: load `/watch/:videoId`, then switch quality via `/watch/:videoId/stream`.
4. Feed/search: test `/feed/home`, `/search?scope=all&q=...`.
5. AI: create session -> send message -> list messages -> rename -> delete message -> clear.
6. Notifications: generate event (upload) -> verify list + unread count + socket event handling.
7. Admin: `/admin/me` -> `/admin/reports` -> one moderation action -> verify audit log.

---

## 30) Where to check if contract changes later

When backend changes, diff these files first:
- `src/app.js`
- `src/routes/*.js`
- `src/controllers/*.js`
- `src/controllers/admin/*.js`
- `src/utils/listResponse.js`
- `src/utils/cache.js`
- `src/middlewares/auth.middleware.js`
- `src/middlewares/admin.middleware.js`

Then update this contract before frontend rollout.
