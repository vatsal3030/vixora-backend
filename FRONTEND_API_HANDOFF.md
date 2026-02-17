# Frontend API Handoff

Last updated: 2026-02-17
Source of truth: `src/app.js`, `src/routes/*`, `src/controllers/*`

## 1) Base URL and Global Behavior

- API base: `/api/v1`
- Media base (separate): `/api/media`
- Health check: `GET /healthz`
- Root check: `GET /`
- Global rate limit: `100 requests/min/IP` on `/api/*`

### Auth transport

Protected routes accept token from either:

- `HttpOnly` cookie: `accessToken`
- `Authorization: Bearer <accessToken>` header

Frontend should always send credentials:

- `fetch`: `credentials: "include"`
- Axios: `withCredentials: true`

## 2) Response and Error Format

### Standard success envelope (most APIs)

```json
{
  "statusCode": 200,
  "data": {},
  "message": "Success",
  "success": true
}
```

### Standard error envelope

```json
{
  "success": false,
  "message": "..."
}
```

Notes:

- Read API payload from `response.data.data`.
- `GET /healthz` and `GET /` are not wrapped in `ApiResponse`.

## 3) Direct Cloudinary Upload Architecture (Important)

Backend contract is now:

1. Frontend creates upload session
2. Frontend asks backend for signed upload params
3. Frontend uploads file directly to Cloudinary
4. Frontend sends Cloudinary metadata back to backend
5. Backend verifies Cloudinary ownership and starts processing

### 3.1 Video Upload Flow (Frontend sequence)

#### Step A: Create upload session

- Endpoint: `POST /api/v1/upload/session` (auth)
- Body:

```json
{
  "fileName": "my-video.mp4",
  "fileSize": 123456789,
  "mimeType": "video/mp4"
}
```

- Success `data` includes session fields (`id`, `status`, `totalSize`, `uploadedSize`, etc.)
- `totalSize`/`uploadedSize` are returned as strings (BigInt-safe)

#### Step B: Get signatures

Get one signature for video and one for thumbnail.

- Endpoint: `GET /api/v1/upload/signature?resourceType=video` (auth)
- Endpoint: `GET /api/v1/upload/signature?resourceType=thumbnail` (auth)

Response `data`:

```json
{
  "timestamp": 1739786400,
  "signature": "...",
  "publicId": "videos/<userId>/<uuid>",
  "cloudName": "...",
  "api_key": "...",
  "resourceType": "video"
}
```

`resourceType` to Cloudinary folder mapping from backend:

- `video` -> `videos/<userId>`
- `thumbnail` -> `thumbnails/<userId>`
- `avatar` -> `avatars/<userId>`
- `post` -> `posts/<userId>`
- fallback -> `misc/<userId>`

#### Step C: Upload directly to Cloudinary

Use Cloudinary upload API directly from frontend with signed params from Step B.

- Video upload URL: `https://api.cloudinary.com/v1_1/<cloudName>/video/upload`
- Image upload URL (thumbnail/avatar/post): `https://api.cloudinary.com/v1_1/<cloudName>/image/upload`

Send multipart form fields:

- `file`
- `api_key`
- `timestamp`
- `signature`
- `public_id`

Keep Cloudinary response values for finalize:

- For video: `secure_url`, `public_id`, `duration`, `width`, `height`
- For thumbnail: `secure_url`, `public_id`

#### Step D (optional but recommended): Push upload progress

- Endpoint: `PATCH /api/v1/upload/progress/:sessionId` (auth)
- Body:

```json
{
  "uploadedBytes": 9876543
}
```

Notes:

- `uploadedBytes` must be non-negative and <= session `totalSize`
- Can be sent as number or numeric string

#### Step E: Finalize upload

- Endpoint: `POST /api/v1/upload/finalize/:sessionId` (auth)
- Body:

```json
{
  "title": "My video title",
  "description": "Video description",
  "publicId": "videos/<userId>/<uuid>",
  "thumbnailPublicId": "thumbnails/<userId>/<uuid>",
  "duration": 142.6,
  "width": 1920,
  "height": 1080,
  "isShort": false,
  "tags": ["news", "daily"]
}
```

Backend behavior on finalize:

- Requires `title`, `description`, `publicId`, `thumbnailPublicId` (URLs are not required)
- Accepts optional `isShort` (`true`/`false`)
- Verifies uploaded assets belong to current user folder
- Uses Cloudinary verified URLs (not blindly trusting client URL)
- Creates DB video row with `processingStatus = PENDING`
- Marks upload session `COMPLETED`
- Enqueues background processing job

#### Step F: Poll processing and publish

- Poll status: `GET /api/v1/videos/:videoId/processing-status` (auth)
- Publish when ready: `PATCH /api/v1/videos/:videoId/publish` (auth)

Processing status enums:

- `PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`, `CANCELLED`

Upload session status enums:

- `INITIATED`, `UPLOADING`, `PROCESSING`, `COMPLETED`, `FAILED`

### 3.2 Image metadata finalize APIs

#### Avatar update

1. Upload avatar to Cloudinary under `avatars/<userId>`
2. Call: `PATCH /api/v1/users/update-avatar` (auth)
3. Body:

```json
{
  "avatarPublicId": "avatars/<userId>/<uuid>"
}
```

#### Cover image update

1. Upload cover image to Cloudinary under `covers/<userId>`
2. Call: `PATCH /api/v1/users/update-coverImage` (auth)
3. Body:

```json
{
  "coverImagePublicId": "covers/<userId>/<uuid>"
}
```

#### Tweet image

- `POST /api/v1/tweets` expects optional `imagePublicId` from `tweets/<userId>`

```json
{
  "content": "tweet text",
  "imagePublicId": "tweets/<userId>/<uuid>"
}
```

## 4) Route Catalog (Frontend usage)

## System

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| GET | `/healthz` | No | Liveness check |
| GET | `/` | No | Backend status |

## OAuth

Base: `/api/v1/auth`

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| GET | `/google` | No | Start Google OAuth |
| GET | `/google/callback` | No | OAuth callback (sets cookies + redirects frontend) |

## Users/Auth

Base: `/api/v1/users`

| Method | Endpoint | Auth | Request body |
|---|---|---|---|
| POST | `/register` | No | `{ fullName, email, username, password }` |
| POST | `/verify-email` | No | `{ identifier, otp }` |
| POST | `/resend-otp` | No | `{ identifier }` |
| POST | `/login` | No | `{ email? OR username?, password }` |
| POST | `/logout` | Yes | none |
| POST | `/refresh-token` | No | `{ refreshToken? }` or cookie |
| GET | `/current-user` | Yes | none |
| POST | `/forgot-password` | No | `{ email }` |
| POST | `/forgot-password/verify` | No | `{ email, otp }` |
| POST | `/reset-password` | No | `{ email, otp, newPassword }` |
| POST | `/change-password` | Yes | `{ oldPassword, newPassword }` |
| PATCH | `/update-account` | Yes | `{ fullName }` |
| PATCH | `/update-avatar` | Yes | `{ avatarPublicId }` |
| PATCH | `/update-coverImage` | Yes | `{ coverImagePublicId }` |
| PATCH | `/update-description` | Yes | `{ channelDescription?, channelLinks? }` |
| GET | `/u/:username` | Yes | none |
| GET | `/id/:userId` | Yes | none |
| DELETE | `/delete-account` | Yes | none |
| PATCH | `/restore-account/request` | No | `{ email? OR username? }` |
| PATCH | `/restore-account/confirm` | No | `{ email? OR username?, otp }` |
| POST | `/change-email/request` | Yes | `{ email }` |
| POST | `/change-email/confirm` | Yes | `{ otp }` |
| POST | `/change-email/cancel` | Yes | none |

## Upload

Base: `/api/v1/upload`

| Method | Endpoint | Auth | Request |
|---|---|---|---|
| POST | `/session` | Yes | `{ fileName, fileSize, mimeType }` |
| PATCH | `/session/:sessionId/cancel` | Yes | none |
| GET | `/signature?resourceType=video|thumbnail|avatar|post` | Yes | query param |
| PATCH | `/progress/:sessionId` | Yes | `{ uploadedBytes }` |
| POST | `/finalize/:sessionId` | Yes | video + thumbnail metadata payload |

## Media

Base: `/api/media`

| Method | Endpoint | Auth | Request |
|---|---|---|---|
| POST | `/finalize/:sessionId` | Yes | `{ uploadType, cloudinaryUrl, publicId }` where `uploadType=avatar|coverImage` |
| DELETE | `/:type` | Yes | `type=avatar|coverImage` |

## Videos

Base: `/api/v1/videos` (all protected)

| Method | Endpoint | Query/body |
|---|---|---|
| GET | `/` | query: `page,limit,query,sortBy,sortType,isShort,tags` |
| GET | `/me` | query: `page,limit,query,sortBy,sortType,isShort,tags` |
| GET | `/user/:userId` | query: `page,limit,query,sortBy,sortType,isShort` |
| GET | `/trash/me` | query: `page,limit,sortBy,sortType,isShort` |
| GET | `/:videoId/processing-status` | none |
| PATCH | `/:videoId/cancel-processing` | none |
| PATCH | `/:videoId/publish` | none |
| PATCH | `/:videoId/restore` | none |
| GET | `/:videoId` | none |
| PATCH | `/:videoId` | body: `{ title?, description? }` |
| DELETE | `/:videoId` | none |

Note: There is no `POST /api/v1/videos` route in current backend. Video creation is via `/api/v1/upload/finalize/:sessionId`.

## Watch (public)

Base: `/api/v1/watch`

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| GET | `/:videoId` | No | Public watch payload + increments views |

## Feed

Base: `/api/v1/feed`

| Method | Endpoint | Auth | Query |
|---|---|---|---|
| GET | `/home` | Yes | `page,limit,sortBy,sortType` |
| GET | `/subscriptions` | Yes | `page,limit,isShort` |
| GET | `/trending` | No | `page,limit,isShort` |
| GET | `/shorts` | No | `page,limit` |

## Comments

Base: `/api/v1/comments` (protected)

| Method | Endpoint | Request |
|---|---|---|
| GET | `/:videoId` | query: `page,limit,sortType` |
| POST | `/:videoId` | body: `{ content }` |
| PATCH | `/c/:commentId` | body: `{ content }` |
| DELETE | `/c/:commentId` | none |

## Likes

Base: `/api/v1/likes` (protected)

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/toggle/v/:videoId` | Toggle video like |
| POST | `/toggle/c/:commentId` | Toggle comment like |
| POST | `/toggle/t/:tweetId` | Toggle tweet like |
| GET | `/videos` | Liked videos list |

## Subscriptions

Base: `/api/v1/subscriptions` (protected)

| Method | Endpoint | Request |
|---|---|---|
| GET | `/` | query: `page,limit` |
| POST | `/c/:channelId/subscribe` | none |
| GET | `/c/:channelId/subscribers/count` | none |
| GET | `/u/subscriptions` | none |
| PATCH | `/c/:channelId/notifications` | body: `{ level }` where `ALL|PERSONALIZED|NONE` |
| GET | `/c/:channelId/status` | none |

## Channels

Base: `/api/v1/channels` (protected)

| Method | Endpoint | Query |
|---|---|---|
| GET | `/:channelId` | none |
| GET | `/:channelId/videos` | `sort=latest|popular|oldest,page,limit` |
| GET | `/:channelId/playlists` | `page,limit` |
| GET | `/:channelId/tweets` | `page,limit` |

## Playlists

Base: `/api/v1/playlists` (protected)

| Method | Endpoint | Request |
|---|---|---|
| POST | `/watch-later/:videoId` | toggle watch later |
| GET | `/watch-later` | query: `page,limit` |
| POST | `/` | body: `{ name, description?, isPublic? }` |
| GET | `/user/me` | query: `page,limit,query,sortBy,sortType` |
| GET | `/user/:userId` | query: `page,limit,query,sortBy,sortType` |
| GET | `/trash/me` | none |
| PATCH | `/:playlistId/restore` | none |
| PATCH | `/add/:videoId/:playlistId` | none |
| PATCH | `/remove/:videoId/:playlistId` | none |
| PATCH | `/:playlistId/toggle-visibility` | none |
| GET | `/:playlistId` | query: `page,limit` |
| PATCH | `/:playlistId` | body: `{ name?, description? }` |
| DELETE | `/:playlistId` | none |

## Tweets

Base: `/api/v1/tweets` (protected)

| Method | Endpoint | Request |
|---|---|---|
| POST | `/` | body: `{ content, imagePublicId? }` |
| GET | `/user/:userId` | query: `page,limit,sortBy,sortType` |
| GET | `/trash/me` | none |
| PATCH | `/:tweetId/restore` | none |
| GET | `/:tweetId` | none |
| PATCH | `/:tweetId` | body: `{ content }` |
| DELETE | `/:tweetId` | none |

## Notifications

Base: `/api/v1/notifications` (protected)

| Method | Endpoint | Request |
|---|---|---|
| GET | `/` | query: `page,limit` |
| GET | `/unread-count` | none |
| GET | `/unread` | query: `page,limit` |
| PATCH | `/:notificationId/read` | none |
| PATCH | `/read-all` | none |
| DELETE | `/:notificationId` | none |
| DELETE | `/` | none |

## Dashboard

Base: `/api/v1/dashboard` (protected)

| Method | Endpoint | Query |
|---|---|---|
| GET | `/overview` | none |
| GET | `/analytics` | `period=7d|30d|90d` |
| GET | `/top-videos` | `limit` |
| GET | `/growth` | none |
| GET | `/insights` | none |

## Settings

Base: `/api/v1/settings` (protected)

| Method | Endpoint | Request |
|---|---|---|
| GET | `/` | none |
| PATCH | `/` | partial settings object |
| POST | `/reset` | none |

Allowed setting fields:

- `profileVisibility` (`PUBLIC` or `PRIVATE`)
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

## Watch History

Base: `/api/v1/watch-history` (protected)

| Method | Endpoint | Request |
|---|---|---|
| GET | `/` | query: `page,limit,query,isShort,sortBy,sortType` |
| POST | `/` | body: `{ videoId, progress, duration }` |
| GET | `/:videoId` | none |
| POST | `/bulk` | body: `{ videoIds: string[] }` |

## 5) Frontend Screen -> API Map

- Auth pages: `/api/v1/users/register`, `/login`, `/verify-email`, `/resend-otp`, `/refresh-token`
- Home: `/api/v1/feed/home`
- Subscriptions feed: `/api/v1/feed/subscriptions` or `/api/v1/subscriptions`
- Trending: `/api/v1/feed/trending`
- Shorts: `/api/v1/feed/shorts`
- Video detail: `/api/v1/videos/:videoId`
- Public watch page: `/api/v1/watch/:videoId`
- Upload studio: `/api/v1/upload/session` -> `/api/v1/upload/signature` -> Cloudinary direct upload -> `/api/v1/upload/finalize/:sessionId` -> `/api/v1/videos/:videoId/processing-status` -> `/api/v1/videos/:videoId/publish`
- Comments panel: `/api/v1/comments/:videoId`, `/api/v1/likes/toggle/c/:commentId`
- Channel page: `/api/v1/channels/:channelId`, `/videos`, `/playlists`, `/tweets`
- Playlists + watch later: `/api/v1/playlists/*`
- Notification bell: `/api/v1/notifications/unread-count`, `/api/v1/notifications`
- Continue watching: `/api/v1/watch-history`, `/api/v1/watch-history/bulk`
- Creator analytics: `/api/v1/dashboard/*`

## 6) Current Integration Constraints (Important)

- Video creation is upload-session based. There is no direct `POST /api/v1/videos`.
- Avatar/Cover update APIs require Cloudinary `publicId`, not file upload multipart.
- Signature endpoint returns custom `resourceType` labels (`thumbnail`, `avatar`, `post`). For Cloudinary URL path, use `/image/upload` for non-video uploads.
- Folder checks are strict in backend verification:
  - video finalize expects `videos/<userId>` and `thumbnails/<userId>`
  - avatar update expects `avatars/<userId>`
  - cover update expects `covers/<userId>`
  - tweet image expects `tweets/<userId>`

If frontend flow uses a different folder than backend expects, finalize/update call will fail with ownership mismatch.
