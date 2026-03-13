# Channel Routes

## Base
- `/api/v1/channels`

## Route File
- `src/routes/channel.routes.js`

## Controller File
- `src/controllers/channel.controller.js`

## Purpose
- Provides public channel profile and channel-tab style content lists.
- Supports frontend tabs: `About`, `Videos`, `Shorts`, `Playlists`, `Tweets`.

## Auth and Middleware
- Channel profile endpoints use `optionalJwt`:
  - `GET /:channelId`
  - `GET /:channelId/about`
- Content tab endpoints are public:
  - `GET /:channelId/videos`
  - `GET /:channelId/shorts`
  - `GET /:channelId/playlists`
  - `GET /:channelId/tweets`

## Endpoints
- `GET /:channelId`
- `GET /:channelId/about`
- `GET /:channelId/videos`
- `GET /:channelId/shorts`
- `GET /:channelId/playlists`
- `GET /:channelId/tweets`

## Request Contracts
- Common path param:
  - `channelId` (required, must reference active non-deleted channel)
- `GET /:channelId/videos` query:
  - `sort`: `latest | popular | oldest` (default `latest`)
  - `page`: default `1`
  - `limit`: default `20`, max `50`
- `GET /:channelId/shorts` query:
  - `sort`: `latest | popular | oldest`
  - `page`: default `1`
  - `limit`: default `30`, max `60`
- `GET /:channelId/playlists` query:
  - `page`: default `1`
  - `limit`: default `50`, max `100`
- `GET /:channelId/tweets` query:
  - `page`: default `1`
  - `limit`: default `20`, max `50`

## Response Data Shape
- `GET /:channelId` and `/about` return channel profile object:

```json
{
  "id": "channelId",
  "username": "channel_username",
  "fullName": "Channel Name",
  "avatar": "https://...",
  "coverImage": "https://...",
  "description": "channelDescription",
  "links": [],
  "joinedAt": "ISO_DATE",
  "isSubscribed": false,
  "subscribersCount": 0,
  "videosCount": 0,
  "shortsCount": 0,
  "playlistsCount": 0,
  "tweetsCount": 0,
  "totalViews": 0,
  "totalLikes": 0,
  "totalComments": 0,
  "about": {},
  "stats": {}
}
```

- Tab list endpoints return normalized list payload:
  - `items[]` + `pagination`
  - videos/shorts items include: `id`, `title`, `thumbnail`, `views`, `createdAt`, `duration`
  - playlist items include: `id`, `name`, `description`, `isPublic`, `videoCount`, `totalDuration`, `updatedAt`, `isWatchLater`
  - tweet items include: `id`, `content`, `image`, `createdAt`, `owner`

## Frontend Notes
- Use channel profile endpoints for header/about blocks.
- Use tab endpoints for paginated tab sections.
- `isSubscribed` is personalized only when JWT is sent; otherwise always guest view.
