# Workers, Microservices, and Side Effects

This file explains backend runtime modes and async behavior that affects frontend UX.

## Runtime Roles

## API Service
- Serves all HTTP routes.
- Can enqueue background video processing jobs.
- May also process videos directly when queue/worker is unavailable.

## Worker Service
- Runs BullMQ worker for `video-processing` queue.
- Updates video processing fields:
  - `processingStatus`
  - `processingProgress`
  - `processingStep`
  - `isHlsReady`
  - `isPublished`
- Dispatches publish notifications after processing completes.

## Scheduler Service
- Runs cron-driven cleanup jobs (nightly cleanup).
- Removes expired soft-deleted media after restore window.

## Redis
- Used by queue and optional cache layer.
- Can be disabled by env flags.

## Docker Microservice Mode
- See `docker-compose.microservices.yml`:
  - `api` container: `RUN_WORKER=false`, `RUN_SCHEDULER=false`
  - `worker` container: `RUN_WORKER=true`
  - `scheduler` container: `RUN_SCHEDULER=true`
  - `redis` container for queue/cache support

## Queue and Processing Behavior

## Normal Queue Path
1. `POST /upload/finalize/:sessionId`
2. backend creates video with `processingStatus=PENDING`
3. backend enqueues `video-processing` job
4. worker processes and marks `COMPLETED`
5. video becomes stream-ready (`isHlsReady=true`, `isPublished=true`)

## Fallback Path (No Queue / Queue Busy / Enqueue Failed)
- backend runs direct processing asynchronously in API process.
- frontend behavior should remain same:
  - poll processing endpoint until completion.

## Processing Status State Machine
- `PENDING` -> `PROCESSING` -> `COMPLETED`
- error/cancel branches:
  - `FAILED`
  - `CANCELLED`

## Frontend UX Requirements
- After finalize, do not assume immediate playback readiness.
- Poll:
  - `GET /videos/:videoId/processing-status`
- Show progress states:
  - preparing, processing, ready, failed, cancelled.

## Notification Side Effects

## Triggered by Backend Events
- video published/updated
- short published
- tweet created

## Notification delivery
- notification rows are written in DB.
- real-time event emitted via socket: `notification:new`
- notification payload includes redirect target metadata.

## Dedup
- duplicate notification suppression is applied within dedup window.
- frontend should not expect one event per every backend action in burst cases.

## WebSocket Notes
- socket auth uses same JWT token.
- user joins room `user:<userId>`.
- real-time notifications are hints; frontend should still sync from `GET /notifications`.

## Cache Side Effects
- some endpoints are cache-backed (L1 memory + optional Redis):
  - examples: video detail, feed/search windows.
- cache is eventually consistent for short TTL windows.
- frontend should trust returned response and not try to manually invalidate server cache.

## Internal Metrics Endpoint
- `GET /internal/usage` returns queue/cache/ai counters.
- protected by `INTERNAL_METRICS_TOKEN`.
- not for public frontend; for ops/admin tools only.
