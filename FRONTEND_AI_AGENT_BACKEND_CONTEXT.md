# Frontend AI Agent Backend Context (Vixora)

Last verified: 2026-02-20  
Source of truth: `Backend/src/app.js`, `Backend/src/routes/*`, `Backend/src/controllers/*`, `Backend/prisma/schema.prisma`

This document is designed for frontend AI agents that need to understand not only endpoint names, but also backend behavior, flow constraints, security checks, and edge cases.

Use this together with `Backend/FRONTEND_API_HANDOFF.md`:

- `FRONTEND_API_HANDOFF.md`: endpoint catalog + payload examples
- `FRONTEND_AI_AGENT_BACKEND_CONTEXT.md`: architecture, invariants, logic, and integration rules

## 1) High-Level Architecture

Backend stack:

- Node.js + Express
- Prisma ORM + PostgreSQL (Neon in production)
- Cloudinary for media storage
- Optional Redis + BullMQ queue (feature-flag controlled)
- Socket.IO for realtime notifications
- Optional Gemini API for AI features

Runtime roles supported by env flags:

- API server: HTTP + Socket.IO
- Worker: background video-processing jobs
- Scheduler: cron-like background jobs

Important: same codebase can run all roles; behavior is controlled by env flags (`RUN_WORKER`, `RUN_SCHEDULER`, `RUN_WORKER_ON_DEMAND`).

## 2) Non-Negotiable Contracts

### 2.1 API Base

- Primary API base: `/api/v1`
- Health: `GET /healthz`
- Root: `GET /`

### 2.2 Auth Transport

Protected routes accept either:

- `HttpOnly` cookie: `accessToken`
- `Authorization: Bearer <accessToken>`

Frontend must send credentials:

- `fetch`: `credentials: "include"`
- Axios: `withCredentials: true`

### 2.3 Response Envelope

Most success responses:

```json
{
  "statusCode": 200,
  "data": {},
  "message": "Success",
  "success": true
}
```

Most error responses:

```json
{
  "success": false,
  "message": "..."
}
```

Note:

- `GET /healthz` and `GET /` are not wrapped in `ApiResponse`.
- Some auth middleware responses are direct JSON, not `ApiResponse`.

### 2.4 List Payload Normalization

Paginated endpoints should be consumed as:

- `data.items`
- `data.pagination`

Do not rely on old alias arrays like `data.videos` or `data.playlists`.

### 2.5 Global Middleware Behavior

- Global API limiter: `100 req/min/IP` on `/api/*`
- Auth limiter on critical auth routes
- OTP limiter on OTP routes
- AI limiter on AI mutation routes
- CORS origin whitelist from `CORS_ORIGIN` parsed in `src/config/cors.config.js`

## 3) Domain Enums Frontend Must Respect

From Prisma schema:

- `ProcessingStatus`: `PENDING | PROCESSING | COMPLETED | FAILED | CANCELLED`
- `UploadStatus`: `INITIATED | UPLOADING | PROCESSING | COMPLETED | FAILED`
- `NotificationLevel`: `ALL | PERSONALIZED | NONE`
- `NotificationType`: `COMMENT | LIKE | SUBSCRIPTION | UPLOAD | MENTION | SYSTEM`
- `ReportTargetType`: `VIDEO | COMMENT | USER | CHANNEL`
- `ReportStatus`: `PENDING | REVIEWED | REJECTED | ACTION_TAKEN`

Quality values used by API responses/queries:

- `AUTO`, `MAX`, manual levels such as `1080p`, `720p`, `480p`, `360p`, `240p`, `144p`

## 4) Route Group to Controller Map

Use this when AI agent needs source inspection.

- Users/Auth: `src/routes/user.routes.js` -> `src/controllers/user.controller.js`
- OAuth: `src/routes/auth.routes.js` -> `src/controllers/auth.controller.js`
- Upload: `src/routes/upload.routes.js` -> `src/controllers/upload.controller.js`
- Media: `src/routes/media.routes.js` -> `src/controllers/media.controller.js`
- Videos: `src/routes/video.routes.js` -> `src/controllers/video.controller.js`, `src/controllers/video.processing.controller.js`
- Watch: `src/routes/watch.routes.js` -> `src/controllers/watch.controller.js`, `src/controllers/video.stream.controller.js`
- Feed: `src/routes/feed.routes.js` -> `src/controllers/feed.controller.js`
- Notifications: `src/routes/notification.routes.js` -> `src/controllers/notification.controller.js`
- Realtime notify service: `src/services/notification.service.js`, socket server in `src/realtime/socket.server.js`
- AI: `src/routes/ai.routes.js` -> `src/controllers/ai.controller.js` + `src/services/ai.service.js`
- Feedback: `src/routes/feedback.routes.js` -> `src/controllers/feedback.controller.js`

## 5) Critical End-to-End Flows

### 5.1 Register -> Verify Email -> Login

1. `POST /users/register`
2. `POST /users/verify-email` with `{ identifier, otp }`
3. `POST /users/login`

Behavior:

- Login blocked until `emailVerified=true`
- OTPs are single active token style with cooldown checks
- Wrong OTP increments attempts and can hit rate/attempt limits

### 5.2 Refresh Token

`POST /users/refresh-token`

- Accepts cookie refresh token or body refresh token
- Verifies DB-stored refresh token match
- Rotates refresh/access tokens
- Returns refreshed user + account-switch payload

### 5.3 Forgot Password Flow

Required order:

1. `POST /users/forgot-password` with email
2. `POST /users/forgot-password/verify` with `{ email, otp }`
3. `POST /users/reset-password` with `{ email, newPassword }`

Key behavior:

- Step 2 sets `passwordResetToken` cookie (path `/api/v1/users`)
- OTP is consumed after successful verify
- Step 3 primarily uses reset-token cookie/body token
- Legacy OTP fallback exists but should not be frontend default

### 5.4 Google OAuth

Routes:

- `GET /auth/google`
- `GET /auth/google/callback`

Behavior:

- Backend sets `oauth_state` cookie and verifies callback state
- On success sets auth cookies and redirects to `FRONTEND_URL`

### 5.5 Multi-Account Switch (No Logout Needed)

Routes:

- `GET /users/account-switch-token`
- `POST /users/switch-account` with `{ accountSwitchToken }`
- `POST /users/switch-account/resolve` with `{ tokens: string[] }`

Design:

- Account switch token contains user id + refresh-token fingerprint
- If target account refresh token changed/expired, switch token becomes invalid
- Frontend should store one switch token per known account profile

### 5.6 Video Upload (Direct Cloudinary)

Canonical flow:

1. `POST /upload/session`
2. `GET /upload/signature`
3. frontend uploads directly to Cloudinary
4. optional `PATCH /upload/progress/:sessionId`
5. `POST /upload/finalize/:sessionId`
6. poll status -> publish

Backend invariants:

- Upload session expires after `UPLOAD_SESSION_TTL_MINUTES` (default 120)
- Finalize verifies Cloudinary publicId ownership by folder
- Backend trusts Cloudinary verification, not frontend URL claims
- Video created with `PENDING`; queue or fallback processor moves it to `COMPLETED`

### 5.7 Avatar / Cover Image Flow

There are two supported patterns:

- Preferred modern pattern via user routes:
  - `PATCH /users/update-avatar` with `{ avatarPublicId }`
  - `PATCH /users/update-coverImage` with `{ coverImagePublicId }`
- Session finalize pattern:
  - `POST /media/finalize/:sessionId` with `{ uploadType, publicId }`

Both enforce:

- verified email
- folder ownership checks (`avatars/<userId>`, `covers/<userId>`)

### 5.8 Video Playback and Quality

Endpoints:

- `GET /watch/:videoId` (public, optional auth)
- `GET /watch/:videoId/stream` (public, optional auth)
- `GET /videos/:videoId` (auth detail endpoint, also supports quality query)

Rules:

- Use `quality` query for requested quality
- `/watch/:videoId` increments views for non-owner
- `/watch/:videoId/stream` does not increment views
- Response includes `playbackUrl`, `selectedQuality`, `availableQualities`, `qualityUrls`, `streaming`

### 5.9 Realtime Notifications

Socket server:

- Path default: `/socket.io`
- Auth via access token (cookie/bearer)
- User joins room `user:<userId>`
- Event emitted: `notification:new`

Frontend behavior on `notification:new`:

1. refresh `GET /notifications/unread-count`
2. refresh notifications list as needed

### 5.10 Feed Personalization + Suppression

Feed endpoints:

- `/feed/home`
- `/feed/subscriptions`
- `/feed/trending`
- `/feed/shorts`

Logic includes:

- availability filter (`isPublished`, `processingStatus=COMPLETED`, `isHlsReady`, non-deleted owner/video)
- personalization using watch-history tag signals and subscriptions
- suppression filters:
  - `NotInterested` videos excluded
  - `BlockedChannel` owners excluded

### 5.11 AI Assistant Layer

Endpoints:

- Sessions: create/list/messages
- Video summary get/generate
- Video ask endpoint
- Transcript endpoints:
  - `GET /ai/videos/:videoId/transcript` (auth)
  - `POST /ai/videos/:videoId/transcript` (owner upsert)
  - `DELETE /ai/videos/:videoId/transcript` (owner delete)
  - public read route: `GET /watch/:videoId/transcript`

Backend behavior:

- Persists in `AIChatSession` and `AIChatMessage`
- If `GEMINI_API_KEY` exists, uses Gemini model fallback chain
- If Gemini unavailable, safe fallback response returned where possible
- Daily quota enforced by counting AI usage records in `BackgroundJob` (`AI_CHAT` / `AI_SUMMARY`) with user correlation
- Chat send response includes compatibility aliases:
  - `data.reply` and `data.answer` (assistant final text)
  - message objects include `content`, `text`, `message`, `role`, `roleLower`
- AI responses include `data.context`:
  - `hasTranscript`, `transcriptChars`, `hasDescription`, `hasSummary`, `quality` (`RICH|LIMITED|MINIMAL`)
- For greeting/small-talk, backend may return `provider = "rule-based"` without consuming Gemini call.
- Transcript inputs supported:
  - plain text transcript
  - SRT/VTT formatted text
  - cue arrays (`cues`/`segments`) with start/end timing + text

### 5.12 Feedback + Reporting

Endpoints:

- Not interested: add/remove/list
- Blocked channel: add/remove/list
- Reports: create/list-my-reports

Behavior:

- Reports validate target entity exists
- Duplicate pending report for same reporter+target returns existing pending report response
- User events are logged for `NOT_INTERESTED` and `REPORT`

## 6) Caching, Queue, and Free-Tier Behavior

### 6.1 Cache

`src/utils/cache.js`:

- L1 in-memory cache + optional Redis cache
- Feed/video/channel style endpoints use short TTL
- Cache should not break response if Redis unavailable

### 6.2 Redis / Queue

`src/queue/redis.connection.js`:

- Redis optional and disabled safely by config
- Uses throttled redis error logs
- Worker can run always or on-demand

Queue/worker:

- BullMQ queue for video processing
- Worker can auto-shutdown when idle (`WORKER_IDLE_SHUTDOWN_MS`)

## 7) Frontend AI Agent Integration Rules

Do:

- Always include credentials
- Read payload from `response.data.data`
- Use `data.items` for paginated lists
- Respect `410` expired upload session and recreate session
- Respect `429` for OTP/AI rate limits and apply retry-backoff UX
- For account switch, maintain secure token map per profile

Do not:

- Do not send Cloudinary URL as source of truth for media ownership
- Do not assume unpublished videos are visible to other users
- Do not call localhost URLs in production builds
- Do not assume all error responses include stack/details in production

## 8) Production Env Checklist (Frontend-Relevant)

Backend critical env (frontend-impact):

- `CORS_ORIGIN`
- `FRONTEND_URL`
- `ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`
- `CLOUDINARY_*`
- `UPLOAD_SESSION_TTL_MINUTES`
- `SOCKET_ENABLED`, `SOCKET_PATH`
- `GEMINI_API_KEY`, `AI_DAILY_MESSAGE_LIMIT`
- `ACCOUNT_SWITCH_SECRET`, `ACCOUNT_SWITCH_EXPIRY` (optional but recommended)

Frontend env alignment:

- API base should point to deployed backend (`/api/v1` base)
- Google sign-in URL must hit deployed backend auth routes, not localhost in production
- Socket client origin/path must match backend socket config

## 9) Quick Debug Mapping (Error -> Likely Cause)

- `401 Unauthorized request`: missing/expired `accessToken` cookie/header
- `401 Invalid refresh token`: refresh token mismatch with DB
- `400 Missing required fields` on finalize: incomplete upload finalize body
- `410 Upload session expired`: session older than TTL
- `Cloudinary lookup failed`: invalid `publicId`, wrong folder, or Cloudinary config issue
- `Not allowed by CORS`: frontend origin not present in `CORS_ORIGIN`
- `Invalid OAuth state` / `redirect_uri_mismatch`: OAuth cookie/state/callback mismatch

## 10) Recommended Read Order for Frontend AI Agents

1. `Backend/src/app.js`
2. `Backend/src/routes/*.js`
3. `Backend/src/controllers/upload.controller.js`
4. `Backend/src/controllers/watch.controller.js` and `Backend/src/controllers/video.stream.controller.js`
5. `Backend/src/controllers/user.controller.js` and `Backend/src/controllers/auth.controller.js`
6. `Backend/src/controllers/feed.controller.js`
7. `Backend/src/controllers/notification.controller.js` + `Backend/src/services/notification.service.js`
8. `Backend/src/controllers/ai.controller.js` + `Backend/src/services/ai.service.js`
9. `Backend/prisma/schema.prisma`
