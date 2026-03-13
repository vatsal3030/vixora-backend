# Watch History Routes

## Base
- `/api/v1/watch-history`

## Route File
- `src/routes/watchHistory.routes.js`

## Controllers
- `saveWatchProgress`
- `getWatchProgress`
- `getContinueWatching`
- `removeWatchHistoryItem`
- `clearWatchHistory`
- `getProgressForVideos`

## Endpoints
- `GET /`
- `DELETE /`
- `POST /`
- `GET /:videoId`
- `DELETE /:videoId`
- `POST /bulk`

## Request Structures
- Save progress body:

```json
{
  "videoId": "uuid",
  "progress": 42,
  "duration": 120
}
```

- Bulk progress body:

```json
{
  "videoIds": ["uuid1", "uuid2"]
}
```

- List query:
- `page`, `limit`, `query`, `isShort`, `includeCompleted`, `sortBy`, `sortType`

- Clear query:
- `completedOnly=true|false`

## Response
- Wrapped in `ApiResponse`.
- List response follows canonical `items + pagination`.

## Frontend Notes
- All endpoints are authenticated.
- Keep progress updates frequent but throttled on client.
