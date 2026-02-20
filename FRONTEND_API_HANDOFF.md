# Frontend API Handoff

Last updated: 2026-02-20
Source of truth: `src/app.js`, `src/routes/*`, `src/controllers/*`

## 1) Base URL and Global Behavior

- API base: `/api/v1`
- Media base: `/api/v1/media` (legacy alias also works: `/api/media`)
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

### Standard list envelope (normalized)

All paginated list APIs now follow one common shape in `data`:

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

List endpoints now return a single array key only:

- Use `data.items` as the canonical list payload.
- Resource aliases like `data.videos` / `data.channels` / `data.playlists` are intentionally not returned.
- Pagination may still include legacy total aliases (for example `totalVideos`) where applicable.

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
  "mimeType": "video/mp4",
  "uploadType": "VIDEO"
}
```

- Success `data` includes session fields (`id`, `status`, `totalSize`, `uploadedSize`, etc.)
- `uploadType` is saved in session (`VIDEO`, `IMAGE`, `AVATAR`, `COVER_IMAGE`, `POST`, `TWEET`, `THUMBNAIL`)
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
- `cover` / `coverimage` -> `covers/<userId>`
- `post` -> `tweets/<userId>`
- `tweet` -> `tweets/<userId>`
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

### 3.3 Avatar/Cover Update Flows (Detailed)

There are 2 valid backend-supported flows for profile images.

Use **Flow A** for normal profile UI (recommended, simpler).
Use **Flow B** only if your frontend already uses upload sessions for all media.

#### Flow A (Recommended): Direct profile update after signed Cloudinary upload

1. Get signature:
   - Avatar: `GET /api/v1/upload/signature?resourceType=avatar`
   - Cover: `GET /api/v1/upload/signature?resourceType=cover` (or `coverimage`)
2. Upload file directly to Cloudinary `image/upload`.
3. Send only `publicId` to user update route:
   - Avatar: `PATCH /api/v1/users/update-avatar`
   - Body:
```json
{
  "avatarPublicId": "avatars/<userId>/<uuid>"
}
```
   - Cover: `PATCH /api/v1/users/update-coverImage`
   - Body:
```json
{
  "coverImagePublicId": "covers/<userId>/<uuid>"
}
```

Backend rules:

- User must be email-verified.
- `publicId` folder must match logged-in user:
  - avatar: `avatars/<userId>/...`
  - cover: `covers/<userId>/...`
- Backend verifies ownership via Cloudinary Admin API.
- Backend replaces old image and stores verified `secure_url`.

#### Flow B (Session-bound): `media/finalize`

1. Create session:
   - `POST /api/v1/upload/session`
```json
{
  "fileName": "avatar.png",
  "fileSize": 240123,
  "mimeType": "image/png",
  "uploadType": "AVATAR"
}
```
   - For cover, use `"uploadType": "COVER_IMAGE"`.
2. Get signature (`resourceType=avatar` or `cover`).
3. Upload directly to Cloudinary.
4. Finalize:
   - `POST /api/v1/media/finalize/:sessionId`
```json
{
  "uploadType": "avatar",
  "publicId": "avatars/<userId>/<uuid>"
}
```
   - Cover example:
```json
{
  "uploadType": "coverImage",
  "publicId": "covers/<userId>/<uuid>"
}
```

Backend rules:

- Session must belong to current user.
- Session must be active (not expired/failed).
- Email must be verified.
- Only `avatar` and `coverImage` are allowed in this route.

#### Common frontend mistakes (why update fails)

- Sending Cloudinary URL instead of `publicId`.
- Uploading avatar/cover into wrong folder.
- Using Cloudinary `/video/upload` for image.
- Forgetting `withCredentials: true` / cookie not sent.
- Calling `/api/media/...` while frontend base already includes `/api/v1`.

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
| POST | `/session` | Yes | `{ fileName, fileSize, mimeType, uploadType? }` |
| PATCH | `/session/:sessionId/cancel` | Yes | none |
| GET | `/signature?resourceType=video|thumbnail|avatar|cover|coverimage|post|tweet` | Yes | query param |
| PATCH | `/progress/:sessionId` | Yes | `{ uploadedBytes }` |
| POST | `/finalize/:sessionId` | Yes | video + thumbnail metadata payload |

## Media

Base: `/api/v1/media` (legacy alias `/api/media` also works)

| Method | Endpoint | Auth | Request |
|---|---|---|---|
| POST | `/finalize/:sessionId` | Yes | `{ uploadType, publicId }` where `uploadType=avatar|coverImage` |
| DELETE | `/:type` | Yes | `type=avatar|coverImage` |

Media finalize notes:

- Requires verified email.
- Requires active upload session (not expired/failed/completed with invalid state).
- Verifies Cloudinary folder ownership (`avatars/<userId>` / `covers/<userId>`).

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
| GET | `/:videoId` | No (optional token supported) | Public watch payload + increments views |

## Feed

Base: `/api/v1/feed`

| Method | Endpoint | Auth | Query |
|---|---|---|---|
| GET | `/home` | Yes | `page,limit,sortBy,sortType` |
| GET | `/subscriptions` | Yes | `page,limit,isShort` |
| GET | `/trending` | No (optional token supported) | `page,limit,isShort,sortBy,sortType` where `sortBy=views|createdAt` |
| GET | `/shorts` | No (optional token supported) | `page,limit,sortBy,sortType,includeComments,commentsLimit` |

Feed notes:

- Feed endpoints exclude videos from soft-deleted channels.
- `/shorts` defaults to include comments (`includeComments=true`, `commentsLimit=5`, max `10`).

## Comments

Base: `/api/v1/comments`

| Method | Endpoint | Auth | Request |
|---|---|---|---|
| GET | `/:videoId` | No (optional token supported) | query: `page,limit,sortType` |
| POST | `/:videoId` | Yes | body: `{ content }` |
| PATCH | `/c/:commentId` | Yes | body: `{ content }` |
| DELETE | `/c/:commentId` | Yes | none |

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
| GET | `/u/subscriptions` | query: `page,limit` |
| PATCH | `/c/:channelId/notifications` | body: `{ level }` where `ALL|PERSONALIZED|NONE` |
| GET | `/c/:channelId/status` | none |

## Channels

Base: `/api/v1/channels` (public; optional token on `/:channelId` and `/:channelId/about` for `isSubscribed`)

| Method | Endpoint | Auth | Query |
|---|---|---|---|
| GET | `/:channelId` | No (optional token supported) | none |
| GET | `/:channelId/about` | No (optional token supported) | none |
| GET | `/:channelId/videos` | No | `sort=latest|popular|oldest,page,limit` (default `limit=20`) |
| GET | `/:channelId/shorts` | No | `sort=latest|popular|oldest,page,limit` (default `limit=30`) |
| GET | `/:channelId/playlists` | No | `page,limit` (default `limit=50`) |
| GET | `/:channelId/tweets` | No | `page,limit` (default `limit=20`) |

`GET /:channelId` and `GET /:channelId/about` include:

- channel about fields (`description`, `channelDescription`, `links`, `channelLinks`, `joinedAt`)
- youtube-like stats (`totalViews`, `totalLikes`, `totalComments`, `videosCount`, `shortsCount`, `playlistsCount`, `tweetsCount`, `subscribersCount`)
- nested `stats` object with aggregate totals (`totalVideos`, `totalShorts`, `totalUploads`, `totalPlaylists`, `totalTweets`, `totalViews`, `totalLikes`, `totalComments`, `subscribersCount`, `joinedAt`)

Channel list endpoints (`/videos`, `/shorts`, `/playlists`, `/tweets`) return normalized list payload only:

- `data.items`
- `data.pagination`

No secondary duplicate arrays (`data.videos`, `data.playlists`, etc.) are returned.

## Playlists

Base: `/api/v1/playlists` (protected)

| Method | Endpoint | Request |
|---|---|---|
| POST | `/watch-later/:videoId` | toggle watch later |
| GET | `/watch-later` | query: `page,limit` |
| POST | `/` | body: `{ name, description?, isPublic? }` |
| GET | `/user/me` | query: `page,limit,query,sortBy,sortType` |
| GET | `/user/:userId` | query: `page,limit,query,sortBy,sortType` |
| GET | `/trash/me` | query: `page,limit` |
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
| GET | `/trash/me` | query: `page,limit` |
| PATCH | `/:tweetId/restore` | none |
| GET | `/:tweetId` | none |
| PATCH | `/:tweetId` | body: `{ content }` |
| DELETE | `/:tweetId` | none |

## Notifications

Base: `/api/v1/notifications` (protected)

| Method | Endpoint | Request |
|---|---|---|
| GET | `/` | query: `page,limit,sortBy,sortType,isRead,type,channelId,q,from,to` |
| GET | `/unread-count` | query: `type,channelId,q,from,to` (optional) |
| GET | `/unread` | query: `page,limit,sortBy,sortType,type,channelId,q,from,to` |
| PATCH | `/:notificationId/read` | none |
| PATCH | `/read-all` | none |
| DELETE | `/:notificationId` | none |
| DELETE | `/` | none |

Supported notification filters:

- `sortBy`: `createdAt|time|type|isRead` (`time` alias => `createdAt`)
- `sortType`: `asc|desc` (default `desc`)
- `isRead`: `true|false` (only for `/notifications`)
- `type`: `COMMENT|LIKE|SUBSCRIPTION|UPLOAD|MENTION|SYSTEM`
- `channelId`: filter by notification sender channel
- `q`: search in title/message/sender name
- `from`: ISO date-time lower bound
- `to`: ISO date-time upper bound

## 4.1) Real-time Notifications (WebSocket)

Backend now supports socket notifications for authenticated users.

- Transport: Socket.IO
- Default path: `/socket.io`
- Auth: same `accessToken` used by API
  - cookie (`accessToken`) OR
  - socket auth token / bearer token
- CORS origins must match backend `CORS_ORIGIN`

Frontend connect example:

```ts
import { io } from "socket.io-client";

const socket = io("https://api.vixora.co.in", {
  path: "/socket.io",
  withCredentials: true,
  // optional if you don't use cookie auth:
  // auth: { token: accessToken }
});
```

Server event:

- `notification:new`
  - payload contains `title`, `message`, `type`, `videoId?`, `data`, `createdAt`, `requiresSync`
  - when received, frontend should refresh:
    - `GET /api/v1/notifications/unread-count`
    - `GET /api/v1/notifications` (or unread list)

Bell-level behavior:

- `ALL`: gets all channel-activity notifications
- `PERSONALIZED`: gets new uploads/shorts
- `NONE`: gets none

Current activity triggers:

- video/short published
- video metadata updated
- tweet/post created

## Dashboard

Base: `/api/v1/dashboard` (protected)

| Method | Endpoint | Query |
|---|---|---|
| GET | `/full` | `period=7d|30d|90d|1y,topVideosPage,topVideosLimit,topVideosSortBy,topVideosSortOrder` |
| GET | `/overview` | `period=7d|30d|90d|1y` |
| GET | `/analytics` | `period=7d|30d|90d|1y` |
| GET | `/top-videos` | `period=7d|30d|90d|1y,sortBy=views|likes|comments|engagement,sortOrder=asc|desc,page,limit` |
| GET | `/growth` | `period=7d|30d|90d|1y` |
| GET | `/insights` | none |

Dashboard payload notes:

- `/full` returns single-call dashboard payload:
  - `period`, `generatedAt`
  - `overview`
  - `analytics`
  - `topVideos`
  - `growth`
  - `insights`
- `/overview` returns:
  - `cards.subscribers|views|likes|videos` with `value` and `trend` (`current`, `previous`, `change`, `changePercent`, `direction`)
  - `totals` and `dateRange`
- `/analytics` returns:
  - `series.views|subscribers|likes` (daily points)
  - `chart` merged timeline for single chart component
- `/top-videos` returns paginated `items` with:
  - `metrics` (`views`, `likes`, `comments`, `engagement`)
  - `periodMetrics` (`views`, `likes`, `comments`) for selected period
- `/growth` returns:
  - `daily` and `cumulative` series for `subscribers`, `videos`, `likes`
- `/insights` returns:
  - `avgViews`, `avgLikes`, `avgComments`, `engagementRate`
  - `bestUploadDay`, `topByLikes`, `topByComments`, `recommendations`

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

Settings notes:

- `PATCH /settings` requires at least one valid field.
- Unknown fields are rejected.
- `defaultPlaybackSpeed` supports numeric values in range `0.25` to `3`.

## Watch History

Base: `/api/v1/watch-history` (protected)

| Method | Endpoint | Request |
|---|---|---|
| GET | `/` | query: `page,limit,query,isShort,includeCompleted,sortBy,sortType` |
| POST | `/` | body: `{ videoId, progress, duration }` |
| GET | `/:videoId` | none |
| POST | `/bulk` | body: `{ videoIds: string[] }` |

Watch history notes:

- `GET /` defaults to continue-watching behavior (`includeCompleted=false`).
- Set `includeCompleted=true` to include fully watched items.
- Allowed `sortBy`: `updatedAt`, `createdAt`, `lastWatchedAt`.

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
- Channel page: `/api/v1/channels/:channelId`, `/about`, `/videos`, `/shorts`, `/playlists`, `/tweets`
- Playlists + watch later: `/api/v1/playlists/*`
- Notification bell: `/api/v1/notifications/unread-count`, `/api/v1/notifications`
- Continue watching: `/api/v1/watch-history`, `/api/v1/watch-history/bulk`
- Creator analytics: `/api/v1/dashboard/*`

## 6) Current Integration Constraints (Important)

- Video creation is upload-session based. There is no direct `POST /api/v1/videos`.
- Avatar/Cover update APIs require Cloudinary `publicId`, not file upload multipart.
- Signature endpoint returns custom `resourceType` labels (`thumbnail`, `avatar`, `post`). For Cloudinary URL path, use `/image/upload` for non-video uploads.
- Media finalize (`/api/v1/media/finalize/:sessionId`, legacy `/api/media/finalize/:sessionId`) trusts only `publicId` and verifies asset ownership on backend; do not send Cloudinary URL as source of truth.
- Folder checks are strict in backend verification:
  - video finalize expects `videos/<userId>` and `thumbnails/<userId>`
  - avatar update expects `avatars/<userId>`
  - cover update expects `covers/<userId>`
  - tweet image expects `tweets/<userId>`

If frontend flow uses a different folder than backend expects, finalize/update call will fail with ownership mismatch.
