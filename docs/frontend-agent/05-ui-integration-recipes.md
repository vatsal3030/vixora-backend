# UI Integration Recipes

This file gives practical frontend call flows.

## Video Upload Flow
1. `POST /upload/session`
2. `GET /upload/signature`
3. Upload file directly to Cloudinary with signature/publicId
4. `PATCH /upload/progress/:sessionId` during upload
5. `POST /upload/finalize/:sessionId`
6. Poll `GET /videos/:videoId/processing-status` every few seconds
7. Stop polling when `processingStatus=COMPLETED` and `isHlsReady=true`
8. Navigate to watch/video page

## Search Page Flow
1. Global page load: `GET /search?scope=all&q=<term>`
2. Tab click:
  - videos tab: `scope=videos&page=1&limit=...`
  - channels tab: `scope=channels&page=1&limit=...`
3. Infinite scroll:
  - increment `page`
  - append `payload.items`
4. Stop when `pagination.hasNextPage=false`

## Feed Page Flow
1. Home logged-in: `GET /feed/home?page=1&limit=...`
2. If frontend needs subscriptions feed: `GET /feed/subscriptions`
3. Guest/public feed: `GET /feed/trending` or `GET /feed/shorts`
4. Respect backend mixed ranking:
  - top section is relevant
  - tail section may be random backfill

## Notification Drawer Flow
1. `GET /notifications/unread-count`
2. `GET /notifications?page=1&limit=...`
3. On click:
  - use `target.url` for route navigation
4. mark read:
  - `PATCH /notifications/:notificationId/read`
5. bulk read:
  - `PATCH /notifications/read-all`

## Watch Page Flow
1. `GET /watch/:videoId` for initial data and default playback URL
2. quality switch:
  - `GET /watch/:videoId/stream?quality=720p` (or desired quality)
3. transcript tab:
  - `GET /watch/:videoId/transcript?page=1&limit=...`

## Watch History Sync
1. On playback progress tick:
  - `POST /watch-history` with `videoId,progress,duration`
2. Continue watching rail:
  - `GET /watch-history`
3. bulk progress for cards:
  - `POST /watch-history/bulk`

## AI Chat Flow
1. start session:
  - `POST /ai/sessions` (optional videoId)
2. load sessions:
  - `GET /ai/sessions`
3. load messages:
  - `GET /ai/sessions/:sessionId/messages`
4. send:
  - `POST /ai/sessions/:sessionId/messages`
5. display:
  - use `payload.reply` and `payload.ai` metadata

## Common Frontend Mistakes to Avoid
- Sending placeholder categories like `"other"` in upload finalize when not intended as real category.
- Assuming `response.data` directly contains business fields (always use `response.data.data`).
- Assuming every list response has legacy aliases (use `items` and `pagination`).
- Ignoring `410` upload session expiry (create a new upload session instead).
- Ignoring `403` unpublished/private access rules for videos/playlists.
