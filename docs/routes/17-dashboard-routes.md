# Dashboard Routes

## Base
- `/api/v1/dashboard`

## Route File
- `src/routes/dashboard.routes.js`

## Controller File
- `src/controllers/dashboard.controller.js`

## Purpose
- Creator analytics and growth dashboard:
  - overview KPIs
  - analytics series
  - top videos
  - growth trends
  - insights
  - full combined payload

## Auth and Middleware
- All dashboard endpoints require JWT (`verifyJwt`).

## Endpoints
- `GET /full`
- `GET /overview`
- `GET /analytics`
- `GET /top-videos`
- `GET /growth`
- `GET /insights`

## Request Contracts
- Common period query:
  - `period`: `7d | 30d | 90d | 1y`
- `GET /top-videos` query:
  - `page`: default `1`
  - `limit`: default `10`, max `20`
  - `sortBy`: `views | likes | comments | engagement`
  - `sortOrder`: `asc | desc`
- `GET /full` can include:
  - `topVideosPage`, `topVideosLimit`, `topVideosSortBy`, `topVideosSortOrder`
  - falls back to `page/limit/sortBy/sortOrder` if topVideos-specific query is not sent.

## Response Data Shape
- `GET /overview`:
  - period/dateRange
  - high-level totals and trend cards (views, likes, comments, subscribers, uploads)
- `GET /analytics`:
  - `summary`
  - `series.views[]`, `series.subscribers[]`, `series.likes[]`
  - merged `chart[]` points by date
- `GET /top-videos`:
  - normalized list (`items + pagination`)
  - each item includes:
    - base video fields (`id`, `title`, `thumbnail`, `createdAt`)
    - `metrics` (`views`, `likes`, `comments`, `engagement`)
    - `periodMetrics` for selected period
  - payload also includes applied `period`, `sortBy`, `sortOrder`
- `GET /growth`:
  - cumulative and daily growth series for subscribers/videos/likes
- `GET /insights`:
  - recommendations and best-performing indicators
- `GET /full`:

```json
{
  "period": "30d",
  "generatedAt": "ISO_DATE",
  "overview": {},
  "analytics": {},
  "topVideos": {},
  "growth": {},
  "insights": {}
}
```

## Validation and Errors
- Invalid period -> `400` (`Allowed: 7d, 30d, 90d, 1y`)
- Invalid top video sortBy -> `400` (`views, likes, comments, engagement`)

## Frontend Notes
- For one-screen dashboard call `/full`.
- For tabbed/lazy analytics pages call granular endpoints to reduce payload size.
