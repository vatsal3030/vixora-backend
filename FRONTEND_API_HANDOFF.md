# Frontend API Handoff

Last updated: 2026-02-12
Source of truth: `src/app.js`, `src/routes/*`, `src/controllers/*`, `prisma/schema.prisma`

## 1) Base and global behavior

- API base path: `/api/v1`
- Health check: `GET /healthz`
- Root: `GET /`
- Global rate limit: `100 requests / minute / IP` on `/api/*`

### Auth transport

- Protected routes require `accessToken` from:
- `HttpOnly` cookie (`accessToken`) OR
- `Authorization: Bearer <token>` header

### Response format

Successful APIs mostly return:

```json
{
  "statusCode": 200,
  "data": {},
  "message": "...",
  "success": true
}
```

Error format (global error middleware):

```json
{
  "success": false,
  "message": "..."
}
```

## 2) Frontend integration rules

- Send credentials for cookie auth (`withCredentials: true` in Axios / `credentials: "include"` in fetch).
- Read payload from `response.data.data` (not from top-level directly).
- On `401`, call refresh endpoint, then retry original request.
- File upload endpoints use `multipart/form-data`.

## 3) Route catalog

## System

| Method | Endpoint | Auth | Purpose | Returns (`data`) |
|---|---|---|---|---|
| GET | `/healthz` | No | Liveness check | `{ status: "ok" }` |
| GET | `/` | No | Basic backend info | `{ success, message, version }` |

## OAuth Auth

Base: `/api/v1/auth`

| Method | Endpoint | Auth | Purpose | Notes |
|---|---|---|---|---|
| GET | `/google` | No | Start Google OAuth | Redirect flow |
| GET | `/google/callback` | No | OAuth callback | Sets cookies + redirects to frontend |

## User/Auth APIs

Base: `/api/v1/users`

| Method | Endpoint | Auth | Params | Query | Body | Returns (`data`) |
|---|---|---|---|---|---|---|
| POST | `/register` | No | - | - | multipart: `avatar` (required), `coverImage` (optional), `fullName`, `email`, `username`, `password` | `{}` |
| POST | `/verify-email` | No | - | - | `{ identifier, otp }` | `{}` |
| POST | `/resend-otp` | No | - | - | `{ identifier }` | `{}` |
| POST | `/login` | No | - | - | `{ email? , username? , password }` | `{ user }` + sets cookies |
| POST | `/logout` | Yes | - | - | - | `{}` + clears cookies |
| POST | `/refresh-token` | No (needs refresh token cookie/body) | - | - | `{ refreshToken? }` | `{}` + rotates cookies |
| GET | `/current-user` | Yes | - | - | - | current user safe fields |
| POST | `/forgot-password` | No | - | - | `{ email }` | `{}` |
| POST | `/forgot-password/verify` | No | - | - | `{ email, otp }` | `{}` |
| POST | `/reset-password` | No | - | - | `{ email, otp, newPassword }` | `{}` |
| POST | `/change-password` | Yes | - | - | `{ oldPassword, newPassword }` | `{}` |
| PATCH | `/update-account` | Yes | - | - | `{ fullName, email }` | updated user |
| PATCH | `/update-avatar` | Yes | - | - | multipart: `avatar` | updated user |
| PATCH | `/update-coverImage` | Yes | - | - | multipart: `coverImage` | updated user |
| PATCH | `/update-description` | Yes | - | - | `{ channelDescription, channelLinks, channelCategory }` | updated user |
| GET | `/u/:username` | Yes | `username` | - | - | channel profile + subscription counts |
| GET | `/id/:userId` | Yes | `userId` | - | - | user profile by id |
| DELETE | `/delete-account` | Yes | - | - | - | `{}` |
| PATCH | `/restore-account/request` | No | - | - | `{ email? , username? }` | `{}` |
| PATCH | `/restore-account/confirm` | No | - | - | `{ email? , username? , otp }` | restored user + sets cookies |

## Videos

Base: `/api/v1/videos` (all routes protected)

| Method | Endpoint | Auth | Params | Query | Body | Returns (`data`) |
|---|---|---|---|---|---|---|
| GET | `/` | Yes | - | `page, limit, query, sortBy, sortType, isShort, tags` | - | `{ videos, pagination }` |
| POST | `/` | Yes | - | - | multipart: `videoFile`, `thumbnail`, fields: `title`, `description`, `tags`, `isShort?` | created video |
| GET | `/me` | Yes | - | `page, limit, query, isShort, sortBy, sortType, tags` | - | `{ videos, pagination }` |
| GET | `/user/:userId` | Yes | `userId` | `page, limit, query, sortBy, sortType, isShort` | - | `{ videos, pagination }` |
| GET | `/:videoId` | Yes | `videoId` | - | - | rich video detail (`likesCount`, `commentsCount`, `isLiked`, `owner`, `tags`) |
| PATCH | `/:videoId` | Yes | `videoId` | - | body: `title?`, `description?`, optional multipart `thumbnail` | updated video |
| DELETE | `/:videoId` | Yes | `videoId` | - | - | `{}` (soft delete) |
| PATCH | `/:videoId/publish` | Yes | `videoId` | - | - | `{ id, isPublished }` |
| GET | `/trash/me` | Yes | - | `page, limit, sortBy, sortType, isShort` | - | deleted videos list |
| PATCH | `/:videoId/restore` | Yes | `videoId` | - | - | restored video |

## Watch endpoint

Base: `/api/v1/watch`

| Method | Endpoint | Auth | Purpose | Returns (`data`) |
|---|---|---|---|---|
| GET | `/:videoId` | No | public watch fetch + increments counters | raw video object |

## Feed

Base: `/api/v1/feed`

| Method | Endpoint | Auth | Query | Returns (`data`) |
|---|---|---|---|---|
| GET | `/home` | Yes | `page, limit, sortBy, sortType` | `{ videos, pagination }` with `watchProgress` |
| GET | `/subscriptions` | Yes | `page, limit, isShort` | `{ videos, pagination }` with `watchProgress` |
| GET | `/trending` | No | `page, limit, isShort` | `{ videos, pagination }` |
| GET | `/shorts` | No | `page, limit` | `{ shorts, pagination }` |

## Comments

Base: `/api/v1/comments` (all routes protected)

| Method | Endpoint | Auth | Params | Query | Body | Returns (`data`) |
|---|---|---|---|---|---|---|
| GET | `/:videoId` | Yes | `videoId` | `page, limit, sortType` | - | `{ comments, pagination }` |
| POST | `/:videoId` | Yes | `videoId` | - | `{ content }` | created comment |
| PATCH | `/c/:commentId` | Yes | `commentId` | - | `{ content }` | updated comment |
| DELETE | `/c/:commentId` | Yes | `commentId` | - | - | `{}` |

## Likes

Base: `/api/v1/likes` (all routes protected)

| Method | Endpoint | Auth | Params | Body | Returns (`data`) |
|---|---|---|---|---|---|
| POST | `/toggle/v/:videoId` | Yes | `videoId` | - | `{ status: "liked" | "unliked" }` |
| POST | `/toggle/c/:commentId` | Yes | `commentId` | - | `{ status: "liked" | "unliked" }` |
| POST | `/toggle/t/:tweetId` | Yes | `tweetId` | - | `{ status: "liked" | "unliked" }` |
| GET | `/videos` | Yes | - | - | `{ videos, pagination }` |

## Subscriptions

Base: `/api/v1/subscriptions` (all routes protected)

| Method | Endpoint | Auth | Params | Query/Body | Returns (`data`) |
|---|---|---|---|---|---|
| GET | `/` | Yes | - | `page, limit` | `{ videos, pagination }` |
| POST | `/c/:channelId/subscribe` | Yes | `channelId` | - | `{ status, subscriberCount }` |
| GET | `/c/:channelId/subscribers/count` | Yes | `channelId` | - | `{ subscriberCount }` |
| GET | `/u/subscriptions` | Yes | - | - | subscribed channels array |
| PATCH | `/c/:channelId/notifications` | Yes | `channelId` | body `{ level }` | subscription row |
| GET | `/c/:channelId/status` | Yes | `channelId` | - | `{ isSubscribed, subscriptionId, notificationLevel }` |

## Channels

Base: `/api/v1/channels` (all routes protected)

| Method | Endpoint | Auth | Params | Query | Returns (`data`) |
|---|---|---|---|---|---|
| GET | `/:channelId` | Yes | `channelId` | - | channel profile + counts + `isSubscribed` |
| GET | `/:channelId/videos` | Yes | `channelId` | `sort, page, limit` | `{ videos, pagination }` |
| GET | `/:channelId/playlists` | Yes | `channelId` | `page, limit` | `{ playlists, pagination }` |
| GET | `/:channelId/tweets` | Yes | `channelId` | `page, limit` | `{ tweets, pagination }` |

## Playlists

Base: `/api/v1/playlists` (all routes protected)

| Method | Endpoint | Auth | Params | Query/Body | Returns (`data`) |
|---|---|---|---|---|---|
| POST | `/watch-later/:videoId` | Yes | `videoId` | - | `{ saved: boolean }` |
| GET | `/watch-later` | Yes | - | - | `{ videos, metadata }` |
| POST | `/` | Yes | - | body `{ name, description?, isPublic? }` | created playlist |
| GET | `/user/me` | Yes | - | `page, limit, query, sortBy, sortType` | `{ playlists, pagination }` |
| GET | `/user/:userId` | Yes | `userId` | `page, limit, query, sortBy, sortType` | `{ playlists, pagination }` |
| GET | `/trash/me` | Yes | - | - | deleted playlists |
| PATCH | `/:playlistId/restore` | Yes | `playlistId` | - | `{}` |
| PATCH | `/add/:videoId/:playlistId` | Yes | `videoId, playlistId` | - | `{}` |
| PATCH | `/remove/:videoId/:playlistId` | Yes | `videoId, playlistId` | - | `{}` |
| PATCH | `/:playlistId/toggle-visibility` | Yes | `playlistId` | - | `{ isPublic }` |
| GET | `/:playlistId` | Yes | `playlistId` | `page, limit` | playlist with paginated videos |
| PATCH | `/:playlistId` | Yes | `playlistId` | body `{ name?, description? }` | updated playlist |
| DELETE | `/:playlistId` | Yes | `playlistId` | - | `{}` (soft delete) |

## Tweets

Base: `/api/v1/tweets` (all routes protected)

| Method | Endpoint | Auth | Params | Query/Body | Returns (`data`) |
|---|---|---|---|---|---|
| POST | `/` | Yes | - | multipart: optional `tweetImage`, body `content` | created tweet |
| GET | `/user/:userId` | Yes | `userId` | `page, limit, sortBy, sortType` | tweets array |
| GET | `/:tweetId` | Yes | `tweetId` | - | tweet |
| PATCH | `/:tweetId` | Yes | `tweetId` | body `{ content }` | updated tweet |
| DELETE | `/:tweetId` | Yes | `tweetId` | - | `{}` |
| PATCH | `/:tweetId/restore` | Yes | `tweetId` | - | `{}` |
| GET | `/trash/me` | Yes | - | - | deleted tweets list |

## Notifications

Base: `/api/v1/notifications` (all routes protected)

| Method | Endpoint | Auth | Params | Query | Returns (`data`) |
|---|---|---|---|---|---|
| GET | `/` | Yes | - | `page, limit` | `{ notifications, pagination }` |
| GET | `/unread-count` | Yes | - | - | `{ unreadCount }` |
| GET | `/unread` | Yes | - | `page, limit` | `{ notifications, pagination }` |
| PATCH | `/:notificationId/read` | Yes | `notificationId` | - | `{}` |
| PATCH | `/read-all` | Yes | - | - | `{}` |
| DELETE | `/:notificationId` | Yes | `notificationId` | - | `{}` |
| DELETE | `/` | Yes | - | - | `{ deletedCount }` |

## Dashboard

Base: `/api/v1/dashboard` (all routes protected)

| Method | Endpoint | Auth | Query | Returns (`data`) |
|---|---|---|---|---|
| GET | `/overview` | Yes | - | totals (`videos, views, likes, comments, subscribers`) |
| GET | `/analytics` | Yes | `period=7d|30d|90d` | date-wise views array |
| GET | `/top-videos` | Yes | `limit` | top videos |
| GET | `/growth` | Yes | - | date-wise upload count |
| GET | `/insights` | Yes | - | `{ avgViews, avgLikes, engagementRate }` |

## Settings

Base: `/api/v1/settings` (all routes protected)

| Method | Endpoint | Auth | Body | Returns (`data`) |
|---|---|---|---|---|
| GET | `/` | Yes | - | user settings |
| PATCH | `/` | Yes | partial settings object | updated settings |
| POST | `/reset` | Yes | - | default settings |

Allowed settings fields in PATCH: `profileVisibility`, `showSubscriptions`, `showLikedVideos`, `allowComments`, `allowMentions`, `emailNotifications`, `commentNotifications`, `subscriptionNotifications`, `systemAnnouncements`, `autoplayNext`, `defaultPlaybackSpeed`, `saveWatchHistory`, `showProgressBar`, `showViewCount`, `showVideoDuration`, `showChannelName`, `personalizeRecommendations`, `showTrending`, `hideShorts`.

## Watch History

Base: `/api/v1/watch-history` (all routes protected)

| Method | Endpoint | Auth | Params | Query/Body | Returns (`data`) |
|---|---|---|---|---|---|
| GET | `/` | Yes | - | `page, limit, query, isShort, sortBy, sortType` | `{ videos, pagination }` |
| POST | `/` | Yes | - | body `{ videoId, progress, duration }` | saved/upserted watch row |
| GET | `/:videoId` | Yes | `videoId` | - | watch row or `null` |
| POST | `/bulk` | Yes | - | body `{ videoIds: string[] }` | map by `videoId` |

## 4) Data usage map for frontend screens

- Login/Register/Forgot password: use `/users/*` endpoints.
- Home (logged-in): `/feed/home`.
- Subscriptions feed: `/feed/subscriptions` or `/subscriptions/`.
- Explore/Trending: `/feed/trending`.
- Shorts: `/feed/shorts`.
- Video details page (rich): `/videos/:videoId` (auth required).
- Public watch fallback: `/watch/:videoId`.
- Comments: `/comments/:videoId` + `/likes/toggle/c/:commentId`.
- Channel page: `/channels/:channelId` + `/channels/:channelId/videos` + `/channels/:channelId/playlists` + `/channels/:channelId/tweets`.
- Playlists + Watch Later: `/playlists/*`.
- Notifications bell: `/notifications/unread-count`, `/notifications`.
- Continue watching/progress: `/watch-history` and `/watch-history/bulk`.
- Creator dashboard: `/dashboard/*`.

## 5) Current backend caveats (important for frontend)

These are observed in current code and can affect integration:

- `GET /feed/home` can throw 500 for users with no personalization match.
- `POST /likes/toggle/t/:tweetId` currently fails after like due server-side bug.
- `POST /users/refresh-token` currently has refresh rotation bug.
- Some user/channel fields are inconsistent with schema (`channelCategory`, `description`) and may fail on related APIs.
- Soft-deleted videos may still appear in some feeds/detail endpoints.
- Login/refresh/logout cookie flags are strict for HTTPS; local HTTP frontend may have auth-cookie issues.

