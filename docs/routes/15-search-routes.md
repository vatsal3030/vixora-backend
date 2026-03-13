# Search Routes

## Base
- `/api/v1/search`

## Route File
- `src/routes/search.routes.js`

## Controller File
- `src/controllers/search.controller.js`

## Purpose
- Global public search for videos, shorts, channels, tweets, and playlists.
- Supports two modes:
  - `scope=all` (multi-type grouped response)
  - typed scope (`videos`, `shorts`, `channels`, `tweets`, `playlists`)
- Includes relevance ranking and random backfill so pages are filled to requested limit.

## Auth and Middleware
- Endpoint uses `optionalJwt` so both guest and logged-in search are supported.

## Endpoints
- `GET /`

## Request Contracts
- Text query aliases:
  - `q` (primary)
  - `query` (alias)
  - `search` (alias)
- Common filters:
  - `scope` or `type`: `all | videos | shorts | channels | tweets | playlists`
  - `tags`: CSV (example: `travel,nature`)
  - `category` or `channelCategory` (channel category filter)
  - `sortBy` (scope-specific; supports `relevance`)
  - `sortType`: `asc | desc` (default `desc`)
- Scope `all`:
  - `perTypeLimit`: default `10`, max `30`
- Typed scope:
  - `page`: default `1`
  - `limit`: default `20`, max `100`

## Sort Field Guidance
- Videos/Shorts: `relevance`, `views`, `duration`, `title`, `date|createdAt|newest`
- Channels: `relevance`, `name|fullName`, `username`, `subscribers`
- Tweets: `relevance`, `likes`, `comments`, `createdAt` (default fallback)
- Playlists: `relevance`, `name`, `videoCount`, `duration`, `createdAt`

## Response Data Shape
- `scope=all` returns grouped payload:

```json
{
  "scope": "all",
  "query": "vadgam",
  "filters": {
    "tags": [],
    "category": null
  },
  "limits": {
    "perTypeLimit": 10
  },
  "results": {
    "videos": [],
    "shorts": [],
    "channels": [],
    "tweets": [],
    "playlists": []
  },
  "totals": {
    "videos": 0,
    "shorts": 0,
    "channels": 0,
    "tweets": 0,
    "playlists": 0
  }
}
```

- Typed scope returns normalized list payload:

```json
{
  "scope": "channels",
  "query": "vadgam",
  "filters": {
    "tags": [],
    "category": null
  },
  "items": [],
  "pagination": {}
}
```

## Search Matching Behavior
- Channel search checks both:
  - `fullName`
  - `username`
- Video/tweet/playlist search checks title/content + owner name fields.
- Relevance mode ranks best matches first, then random backfill fills remaining slots to satisfy page size.

## Validation and Errors
- `q` max length: `120` characters.
- Invalid typed scope returns `400 Invalid scope`.

## Frontend Notes
- For universal page use `scope=all`.
- For tab pages use typed scope with `page` and `limit`.
- Do not assume all results from one account; backend mixes relevant-first and random-fill entries.
