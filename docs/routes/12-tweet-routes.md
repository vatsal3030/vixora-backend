# Tweet Routes

## Base
- `/api/v1/tweets`

## Route File
- `src/routes/tweet.routes.js`

## Controller File
- `src/controllers/tweet.controller.js`

## Purpose
- Handles tweet CRUD for authenticated users.
- Exposes public/personalized tweet feed.
- Exposes hot topic discovery from recent tweets.

## Auth and Middleware
- Public with optional auth (`optionalJwt`):
  - `GET /feed`
  - `GET /topics/hot`
  - `GET /explore` (alias of `/feed`)
  - `GET /:tweetId`
- Protected (`verifyJwt`): all other endpoints.

## Endpoints
- Feed and discovery:
  - `GET /feed`
  - `GET /explore`
  - `GET /topics/hot`
  - `GET /:tweetId`
- User/owner actions:
  - `POST /`
  - `GET /user/:userId`
  - `GET /trash/me`
  - `PATCH /:tweetId`
  - `DELETE /:tweetId`
  - `PATCH /:tweetId/restore`

## Request Contracts
- `GET /feed` query:
  - `mode`: `forYou | following | latest | hot`
  - `topic`: topic filter (with or without `#`)
  - `page`: default `1`
  - `limit`: default `30`, max `100`
  - `sortType`: `asc | desc` (default `desc`)
- `GET /topics/hot` query:
  - `q`: optional topic search
  - `limit`: default `12`, max `30`
  - `windowHours`: default `72`, max `336`
- `GET /user/:userId` query:
  - `page`, `limit` (max `50`)
  - `sortBy`: `createdAt | updatedAt`
  - `sortType`: `asc | desc`
- `POST /` body:

```json
{
  "content": "Text required, max 500 chars",
  "imagePublicId": "optional-cloudinary-public-id"
}
```

- `PATCH /:tweetId` body:

```json
{
  "content": "Updated text, required, max 500 chars"
}
```

## Response Data Shape
- Feed/list endpoints return normalized list payload:

```json
{
  "items": [
    {
      "id": "tweetId",
      "content": "text",
      "image": "https://...",
      "createdAt": "ISO_DATE",
      "owner": {
        "id": "userId",
        "username": "channel_username",
        "fullName": "Channel Name",
        "avatar": "https://..."
      },
      "likesCount": 0,
      "commentsCount": 0,
      "isLikedByMe": false,
      "topics": ["topic1", "topic2"]
    }
  ],
  "pagination": {},
  "mode": "forYou",
  "filters": {
    "topic": "optional-topic"
  },
  "ranking": "personalized+backfill",
  "followingChannelsCount": 12,
  "blockedChannels": 0,
  "usedBackfill": true,
  "backfillCount": 5
}
```

- `GET /topics/hot` data:
  - `windowHours`
  - `generatedAt`
  - `items[]` with:
    - `topic`, `displayName`, `slug`
    - `mentions`, `engagement`, `trendScore`
    - `sampleTweetIds[]`
- `GET /:tweetId` returns single tweet object with:
  - `likesCount`, `commentsCount`, `isLikedByMe`, `topics`

## Behavioral Notes
- `DELETE /:tweetId` is soft delete (`isDeleted=true`), not permanent hard delete.
- `PATCH /:tweetId/restore` restores only owner-deleted tweet.
- Tweet creation dispatches channel activity notifications for followers.
- Feed guarantees fill behavior with random backfill when primary set is smaller than requested `limit`.
