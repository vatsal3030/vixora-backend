# Watch Routes

## Base
- `/api/v1/watch`

## Route File
- `src/routes/watch.routes.js`

## Controllers
- `watchVideo`
- `getVideoStreamingData`
- `getVideoTranscript`

## Purpose
- Public watch APIs with optional authentication context.

## Endpoints
- `GET /:videoId`
- `GET /:videoId/stream`
- `GET /:videoId/transcript`

## Query Parameters
- Watch detail:
  - `quality`
- Stream endpoint:
  - `quality`
- Transcript endpoint:
  - `q`, `from`, `to`, `fromSeconds`, `toSeconds`, `page`, `limit`

## Response
- `/:videoId` returns watch payload + selected playback URL and video metadata.
- `/:videoId/stream` returns stream data for quality switching.
- `/:videoId/transcript` returns transcript text/segments with pagination and filtering support.

## Frontend Notes
- Use `/watch/:videoId` for initial load.
- Use `/watch/:videoId/stream` for quality switch to avoid extra side effects.
