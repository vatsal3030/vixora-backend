# Feed Routes

## Base
- `/api/v1/feed`

## Route File
- `src/routes/feed.routes.js`

## Controller File
- `src/controllers/feed.controller.js`

## Purpose
- Powers home/subscription/trending/shorts feeds.
- Supports tag discovery and tag-specific feed.
- Applies personalization, suppression, and random backfill to keep response filled to requested limit.

## Auth and Middleware
- Optional auth (`optionalJwt`):
  - `GET /tags`
  - `GET /tags/:tagName`
  - `GET /trending`
  - `GET /shorts`
- Protected (`verifyJwt`):
  - `GET /home`
  - `GET /subscriptions`

## Endpoints
- `GET /tags`
- `GET /tags/:tagName`
- `GET /home`
- `GET /subscriptions`
- `GET /trending`
- `GET /shorts`

## Request Contracts
- `GET /tags` query:
  - `page`: default `1`
  - `limit`: default `30`, max `100`
  - `q`: optional tag search text
- `GET /tags/:tagName` query:
  - `page`: default `1`
  - `limit`: default `20`, max `100`
  - `sortBy`: `score | createdAt` (default `score`)
  - `sortType`: `asc | desc` (default `desc`)
- `GET /home` query:
  - `page`, `limit` (max `100`)
  - `tag`: optional tag slug
  - `sortBy`: `createdAt | views`
  - `sortType`: `asc | desc`
- `GET /subscriptions` query:
  - `page`, `limit` (max `100`)
  - `isShort`: `true | false` (optional)
- `GET /trending` query:
  - `page`, `limit` (max `100`)
  - `isShort`: `true | false` (optional)
  - `sortBy`: `views | createdAt`
  - `sortType`: `asc | desc`
- `GET /shorts` query:
  - `page`, `limit` (max `100`)
  - `sortBy`: `createdAt | views`
  - `sortType`: `asc | desc`
  - `includeComments`: boolean (default `true`)
  - `commentsLimit`: default `5`, max `10`

## Response Data Shape
- All list endpoints return normalized payload:

```json
{
  "items": [],
  "pagination": {},
  "filters": {
    "usedBackfill": true,
    "backfillCount": 8
  }
}
```

- Common item behavior:
  - video-based feed entries include owner/tags/categories and `watchProgress` (if user exists).
  - shorts include `playbackUrl`, `likesCount`, `commentsCount`, `isLiked`, optional latest comments.
- `GET /tags` item shape includes scores:
  - `id`, `name`, `displayName`, `slug`, `videoCount`, `lastVideoAt`
  - `scores.final`, `scores.trending`, `scores.interest`
- `GET /tags/:tagName` includes extra `tag` object and personalization metadata.

## Feed Ranking and Fill Strategy
- Primary ranking is relevance/personalized for each feed type.
- If relevant pool is smaller than requested `limit`, backend appends random backfill candidates.
- Response exposes this in `filters.usedBackfill` and `filters.backfillCount`.
- Frontend should always trust returned `items.length` up to requested `limit`, not assume personalized-only results.

## Frontend Notes
- Use `/home` for signed-in personalized landing.
- Use `/trending` or `/shorts` for guest/public feed blocks.
- Always pass `limit` explicitly for stable infinite-scroll behavior.
