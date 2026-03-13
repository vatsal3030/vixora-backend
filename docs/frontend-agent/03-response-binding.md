# Response Binding Guide (Frontend Use)

This file explains exactly how frontend should consume response payloads.

## Universal Read Rule
- axios/fetch response payload path:
  - `const payload = response.data.data`
- message path:
  - `response.data.message`

## List UI Binding Rule
- For list screens:
  - `const items = payload.items ?? []`
  - `const pagination = payload.pagination ?? {}`

## Search Binding

### `scope=all`
- `payload.results.videos`
- `payload.results.shorts`
- `payload.results.channels`
- `payload.results.tweets`
- `payload.results.playlists`
- `payload.totals.<type>`

### typed scope
- `payload.items`
- `payload.pagination`
- `payload.scope`
- `payload.filters`

## Feed Binding
- Feed endpoints return `items + pagination` plus filter metadata:
  - `payload.items`
  - `payload.pagination`
  - `payload.filters.usedBackfill`
  - `payload.filters.backfillCount`

### Important
- Do not assume all items are personalized.
- Relevant-first items may be followed by random backfill to satisfy requested limit.

## Notification Binding
- Use clickable target fields in priority order:
  1. `item.target.url`
  2. `item.target.fallbackUrls[0]`
  3. no navigation

- For compatibility use either:
  - nested: `item.data.target`
  - flat: `item.targetType`, `item.targetId`, `item.targetUrl`

## Watch + Stream Binding

### `GET /watch/:videoId`
- playback:
  - `payload.playbackUrl`
  - `payload.streaming.availableQualities`
  - `payload.streaming.selectedQuality`
- info:
  - `payload.title`, `payload.owner`, `payload.views`, `payload.duration`

### `GET /watch/:videoId/stream`
- quality switching:
  - `payload.playbackUrl`
  - `payload.qualities`
  - `payload.qualityUrls`

## Upload Finalize Binding
- `POST /upload/finalize/:sessionId` returns created video immediately.
- Processing is asynchronous; use:
  - `GET /videos/:videoId/processing-status`
- UI should poll until:
  - `processingStatus === "COMPLETED"`
  - and `isHlsReady === true`

## AI Binding

### Chat session message response
- `payload.reply` or `payload.answer`
- `payload.userMessage`
- `payload.assistantMessage`
- `payload.context`
- `payload.ai.provider`, `payload.ai.warning`, `payload.ai.quota`

### Transcript response
- `payload.items` (segments)
- `payload.transcript` (full text)
- `payload.filters`

## Dashboard Binding
- Single payload:
  - `GET /dashboard/full`
- read:
  - `payload.overview`
  - `payload.analytics`
  - `payload.topVideos`
  - `payload.growth`
  - `payload.insights`

## Common Error Handling Rules
- `400`: validation or bad request
- `401`: unauthenticated/invalid token
- `403`: authenticated but not allowed
- `404`: not found or unavailable
- `409`: duplicate/conflict
- `410`: upload session expired
- `429`: rate limit/OTP or AI quota

## Minimal Frontend Guard Helpers

```ts
export const getPayload = (res: any) => res?.data?.data ?? null;
export const getItems = (res: any) => getPayload(res)?.items ?? [];
export const getPagination = (res: any) => getPayload(res)?.pagination ?? null;
export const getMessage = (res: any) => res?.data?.message ?? "";
```
