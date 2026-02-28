# Frontend Integration Playbook (Backend Contract in Depth)

Last updated: 2026-02-28
Source of truth: `src/app.js`, `src/routes/*`, `src/controllers/*`, `prisma/schema.prisma`

This file is for frontend engineers and frontend AI agents.

Goal: remove ambiguity about which endpoint to call, when to call it, what payload to send, and exactly which fields to read from response.

---

## 1) Base Rules (Do Not Skip)

### 1.1 API base
- API base: `/api/v1`
- Health: `GET /healthz`

### 1.2 Auth transport
Protected routes accept:
- `HttpOnly` cookie: `accessToken`
- OR `Authorization: Bearer <token>`

Frontend must always send credentials:
- `fetch`: `credentials: "include"`
- Axios: `withCredentials: true`

### 1.3 Response reading contract
Most success responses use:
```json
{
  "statusCode": 200,
  "data": {},
  "message": "...",
  "success": true
}
```
Read payload from `response.data.data`.

List responses (paginated) use:
```json
{
  "items": [],
  "pagination": {
    "currentPage": 1,
    "page": 1,
    "itemsPerPage": 20,
    "limit": 20,
    "totalItems": 0,
    "total": 0,
    "totalPages": 0,
    "hasPrevPage": false,
    "hasNextPage": false
  }
}
```
Use `data.items` only (do not rely on legacy aliases).

### 1.4 Error handling contract
Common error shape:
```json
{
  "success": false,
  "message": "..."
}
```
Show `message` to user where safe.

### 1.5 Route selection rule
Do not pick route by name similarity. Pick route by product intent:
- watch public content -> `/watch/*`
- manage own content -> `/videos/*` (auth)
- upload lifecycle -> `/upload/*` and `/media/*`
- admin moderation -> `/admin/*`

---

## 2) Which Route to Choose (Decision Matrix)

### 2.1 Video detail/watch page
- First page load (and count view): `GET /watch/:videoId?quality=auto`
- Quality switch without extra view count: `GET /watch/:videoId/stream?quality=720p`
- Owner studio detail: `GET /videos/:videoId`

### 2.2 Upload studio
1. `POST /upload/session`
2. `GET /upload/signature`
3. Upload file directly to Cloudinary
4. Optional progress: `PATCH /upload/progress/:sessionId`
5. Finalize: `POST /upload/finalize/:sessionId`
6. Poll process: `GET /videos/:videoId/processing-status`
7. Publish: `PATCH /videos/:videoId/publish`

### 2.3 Avatar/cover update
Preferred:
1. `GET /upload/signature?resourceType=avatar|cover`
2. Direct Cloudinary image upload
3. `PATCH /users/update-avatar` or `PATCH /users/update-coverImage` with `publicId`

### 2.4 Global search bar
- Use `GET /search?scope=all&q=...` for mixed results dropdown/page
- Use `scope=videos|channels|tweets|playlists` for dedicated tab pages

### 2.5 AI chatbox
- open/create session: `POST /ai/sessions`
- list sessions: `GET /ai/sessions`
- fetch chat messages: `GET /ai/sessions/:sessionId/messages`
- send message: `POST /ai/sessions/:sessionId/messages`
- rename session: `PATCH /ai/sessions/:sessionId`
- delete session: `DELETE /ai/sessions/:sessionId`
- clear all sessions: `DELETE /ai/sessions`
- clear one session history: `DELETE /ai/sessions/:sessionId/messages`

### 2.6 Admin panel
Always use `/admin/*`, not normal user routes for moderation actions.

---

## 3) Core User App Flows (Request + Response Binding)

## 3.1 Register + verify + login

### Register
- `POST /users/register`
- Body:
```json
{
  "fullName": "...",
  "email": "...",
  "username": "...",
  "password": "..."
}
```

### Verify email OTP
- `POST /users/verify-email`
- Body:
```json
{
  "identifier": "email_or_username",
  "otp": "123456"
}
```

### Login
- `POST /users/login`
- Body:
```json
{
  "email": "...",
  "password": "..."
}
```
- Response data binding:
  - user: `data.user`
  - account switch token payload: `data.accountSwitch`
- Cookies set by backend: `accessToken`, `refreshToken`

## 3.2 Session refresh
- `POST /users/refresh-token`
- Usually no body needed if refresh cookie exists
- Response data:
  - `data.user`
  - `data.accountSwitch`

## 3.3 Forgot password flow
1. `POST /users/forgot-password` with `{ email }`
2. `POST /users/forgot-password/verify` with `{ email, otp }`
3. `POST /users/reset-password` with `{ email, newPassword }`

Notes:
- Step 2 sets cookie `passwordResetToken`.
- Preferred step 3 uses cookie automatically.
- Legacy fallback: send `resetToken` in body if cookie unavailable.

## 3.4 Account switch (multi-account)
- get current account switch token: `GET /users/account-switch-token`
- switch account: `POST /users/switch-account` with:
```json
{
  "accountSwitchToken": "..."
}
```
- resolve stale tokens list: `POST /users/switch-account/resolve`

## 3.5 Profile update
- account info: `PATCH /users/update-account`
- description and links: `PATCH /users/update-description`
- avatar: `PATCH /users/update-avatar` with `avatarPublicId`
- cover: `PATCH /users/update-coverImage` with `coverImagePublicId`

---

## 4) Upload and Media in Depth

## 4.1 Why session exists
Upload session tracks:
- owner (`userId`)
- upload status (`INITIATED`, `UPLOADING`, ...)
- total bytes and uploaded bytes
- TTL expiry (controlled by `UPLOAD_SESSION_TTL_MINUTES`)

If session expired, backend returns `410` and frontend must create a new session.

## 4.2 Signature endpoint behavior
`GET /upload/signature?resourceType=...`
Allowed resource types include:
- `video`, `thumbnail`, `avatar`, `cover`, `coverimage`, `post`, `tweet`

Backend returns:
- `timestamp`
- `signature`
- `publicId`
- `cloudName`
- `api_key`
- `resourceType`

Frontend must upload to Cloudinary endpoint matching type:
- video -> `/video/upload`
- non-video -> `/image/upload`

## 4.3 Finalize video upload
`POST /upload/finalize/:sessionId`
Required fields:
- `title`
- `description`
- `publicId`
- `thumbnailPublicId`

Optional fields:
- `isShort`
- `duration`, `width`, `height`
- `tags`
- transcript payload (`transcript`, `transcriptCues`, `language`)

Response:
- created video object in `data.video`
- use id for polling/publish

---

## 5) Watch, Video, Feed, Search

## 5.1 Watch route contract
`GET /watch/:videoId`
Returns playback payload optimized for watch page.
Key fields to bind:
- `playbackUrl`
- `selectedQuality`
- `availableQualities`
- `qualityUrls`
- `streaming`

For quality switching call:
- `GET /watch/:videoId/stream?quality=...`

## 5.2 Video management route contract
`/videos/*` is authenticated creator/studio side.

Use:
- `GET /videos` for full list
- `GET /videos/me` for current user uploads
- `GET /videos/trash/me` for deleted videos
- `PATCH /videos/:videoId` to edit metadata
- `DELETE /videos/:videoId` soft delete
- `PATCH /videos/:videoId/restore`
- `PATCH /videos/:videoId/publish`

## 5.3 Feed route contract
- `/feed/home` (auth)
- `/feed/subscriptions` (auth)
- `/feed/trending` (public/optional auth)
- `/feed/shorts` (public/optional auth)

Each returns `data.items` + `data.pagination`.

## 5.4 Search route contract
`GET /search`
Parameters:
- `scope`: `all|videos|channels|tweets|playlists`
- `q`
- optional filters: `tags`, `category`, `channelCategory`, sort fields

Response:
- if `scope=all`: grouped buckets in `data.results`
- if typed scope: `data.items` + `data.pagination`

---

## 6) AI Contract (Critical for UI)

## 6.1 Session/message operations
- create session: `POST /ai/sessions`
- list sessions: `GET /ai/sessions`
- messages: `GET /ai/sessions/:sessionId/messages`
- send: `POST /ai/sessions/:sessionId/messages`

Send-message response important fields:
- `data.userMessage`
- `data.assistantMessage`
- `data.reply` (primary text)
- `data.answer` (alias)
- `data.context` (context quality)
- `data.ai` (provider/model/quota/confidence/citations)

Frontend render fallback order:
1. `data.reply`
2. `data.assistantMessage.text`
3. `data.assistantMessage.message`
4. `data.assistantMessage.content`

## 6.2 Transcript quality effect
AI quality heavily depends on transcript richness.
For best answers use transcript endpoints:
- `POST /ai/videos/:videoId/transcript` (owner)
- `GET /watch/:videoId/transcript` (public read)

If transcript missing, backend may still answer but confidence/context quality will be lower.

---

## 7) Notifications and Realtime

## 7.1 REST
- list: `GET /notifications`
- unread count: `GET /notifications/unread-count`
- unread list: `GET /notifications/unread`
- mark one: `PATCH /notifications/:notificationId/read`
- mark all: `PATCH /notifications/read-all`

## 7.2 Socket
- Socket.IO path default: `/socket.io`
- event: `notification:new`

On event:
1. refresh unread count
2. refresh list if bell panel open

---

## 8) Admin Panel Frontend Specification (Detailed)

This section is the blueprint for your separate admin frontend.

## 8.1 Admin auth model
There is no separate admin login endpoint.
Admin uses same login/session as user app.

Authentication:
- login via `/users/login` (same flow)
- call `/admin/me` after login
- if 403 -> user is not admin role
- if 404 -> admin panel disabled (`ADMIN_PANEL_ENABLED=false`)

## 8.2 How admin is assigned

### First super admin (bootstrap)
Backend startup checks env `ADMIN_BOOTSTRAP_EMAILS`.
Any existing user whose email is in this list gets role `SUPER_ADMIN`.

Required startup steps:
1. Ensure target user account exists.
2. Set env:
   - `ADMIN_PANEL_ENABLED=true`
   - `ADMIN_BOOTSTRAP_EMAILS=admin@example.com`
3. Restart backend.
4. Login with that user.
5. Verify with `GET /admin/me`.

### Assign additional admins/moderators
Only `SUPER_ADMIN` can change roles:
- `PATCH /admin/users/:userId/role`

Body:
```json
{
  "role": "MODERATOR",
  "reason": "..."
}
```

Role values:
- `USER`
- `MODERATOR`
- `ADMIN`
- `SUPER_ADMIN`

Safety:
- last `SUPER_ADMIN` cannot be demoted.

## 8.3 Role permission matrix for frontend gating

### MODERATOR UI should show
- reports list/detail/resolve
- content moderation for videos/tweets/comments/playlists
- user status update only (`ACTIVE` or `RESTRICTED`)

### MODERATOR UI should hide/disable
- user soft delete/restore
- verify pending email
- role update
- audit logs

### ADMIN UI should show
- all moderator features
- user suspend/delete/restore
- pending email verify
- audit logs read

### ADMIN UI should hide/disable
- role update endpoint

### SUPER_ADMIN UI should show
- everything including role update

## 8.4 Admin IA (recommended pages)
1. `/admin/login-check`
2. `/admin/dashboard`
3. `/admin/reports`
4. `/admin/users`
5. `/admin/videos`
6. `/admin/tweets`
7. `/admin/comments`
8. `/admin/playlists`
9. `/admin/audit-logs`

## 8.5 Page-to-endpoint mapping

### Dashboard
- `GET /admin/dashboard/overview?period=7d|30d|90d|1y`
- `GET /admin/dashboard/activity?period=...`

### Reports page
- table: `GET /admin/reports`
- detail drawer: `GET /admin/reports/:reportId`
- resolve modal: `PATCH /admin/reports/:reportId/resolve`

### Users page
- table: `GET /admin/users`
- detail: `GET /admin/users/:userId`
- status: `PATCH /admin/users/:userId/status`
- verify pending email: `PATCH /admin/users/:userId/verify-pending-email`
- soft delete/restore: respective patch endpoints
- role update (super admin only): `PATCH /admin/users/:userId/role`

### Content pages
- videos: `GET /admin/videos`, `GET /admin/videos/:videoId`, moderation actions
- tweets/comments/playlists: list + detail + soft-delete + restore

### Audit logs
- list filters: `GET /admin/audit-logs`
- detail: `GET /admin/audit-logs/:logId`

## 8.6 Moderation action policy (frontend UX)
- all delete actions are soft-delete, not hard-delete
- restore only valid for 7 days from deletion
- always require reason input for destructive action
- use confirm dialogs with explicit target title/id

## 8.7 Admin UI data contract tips
- every list reads from `data.items`
- all tables must support pagination from `data.pagination`
- never trust client-side role assumptions; always gate by `/admin/me` permissions

## 8.8 Admin UI consistency with main website
To keep consistency with current site style:
- reuse same typography scale and spacing rhythm as consumer app
- reuse same color tokens and elevation hierarchy
- keep card, table, modal corner radius same as user app
- use same button styles and form controls
- use same toast/alert pattern
- do not create a visually disconnected "enterprise" theme

Recommended layout:
- left sidebar + top bar (matches current app density)
- list pages with sticky filter bar
- right-side detail drawer for quick inspect
- destructive actions in modal with reason field

---

## 9) Backend Flags that Directly Affect Frontend Behavior

Required / important:
- `CORS_ORIGIN`
- `FRONTEND_URL`
- `ADMIN_FRONTEND_URL` (if separate admin app)
- `ADMIN_PANEL_ENABLED`
- `ADMIN_BOOTSTRAP_EMAILS`
- `GOOGLE_CALLBACK_URL`
- `SOCKET_ENABLED`, `SOCKET_PATH`
- `UPLOAD_SESSION_TTL_MINUTES`

If these are wrong, frontend will fail even with correct code.

---

## 10) Common Frontend Mistakes and Exact Fix

1) Mistake: using `/videos/:id` for public watch page
- Fix: use `/watch/:id` for public playback

2) Mistake: sending Cloudinary URL instead of publicId for avatar/cover
- Fix: send only `avatarPublicId` / `coverImagePublicId`

3) Mistake: calling admin routes before checking `/admin/me`
- Fix: gate admin app boot with `/admin/me` result

4) Mistake: assuming list payload key by endpoint name
- Fix: always use `data.items`

5) Mistake: using localhost API in production frontend env
- Fix: verify Vercel env uses production API base

6) Mistake: forgetting `withCredentials`
- Fix: enable credentials globally in frontend HTTP client

---

## 11) Suggested Frontend Build Sequence

### Main app
1. Auth/session foundation
2. Watch page + quality switch
3. Upload studio flow
4. Channel/profile/settings
5. Feed/search/notifications
6. AI panel

### Admin app
1. Auth check + role guard (`/admin/me`)
2. Dashboard
3. Reports workflow
4. User moderation
5. Content moderation modules
6. Audit logs

This order gives quickest production stability.

---

## 12) Admin Quick Start Checklist

1. Create user account normally.
2. Verify email.
3. Set env:
   - `ADMIN_PANEL_ENABLED=true`
   - `ADMIN_BOOTSTRAP_EMAILS=<that_email>`
4. Restart backend.
5. Login.
6. Call `GET /api/v1/admin/me`.
7. Build admin frontend after this succeeds.

If step 6 fails:
- 404: panel disabled
- 403: not admin role
- 401: missing auth cookie/header

---

## 13) Where to look in backend code

- Route map: `src/app.js`
- User/auth logic: `src/controllers/user.controller.js`
- Upload logic: `src/controllers/upload.controller.js`
- Watch/stream logic: `src/controllers/watch.controller.js`
- AI logic: `src/controllers/ai.controller.js`
- Admin logic: `src/routes/admin.routes.js`, `src/controllers/admin/*`, `src/services/admin.*`
- Role/guard logic: `src/middlewares/admin.middleware.js`, `src/config/admin.config.js`

