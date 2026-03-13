# Admin Routes

## Base
- `/api/v1/admin`

## Route File
- `src/routes/admin.routes.js`

## Controller Files
- `src/controllers/admin/admin.dashboard.controller.js`
- `src/controllers/admin/admin.reports.controller.js`
- `src/controllers/admin/admin.users.controller.js`
- `src/controllers/admin/admin.content.controller.js`
- `src/controllers/admin/admin.audit.controller.js`
- `src/controllers/admin/admin.feed.controller.js`

## Purpose
- Admin panel backend for moderation and operations:
  - dashboard and activity
  - reports resolution
  - user moderation
  - content moderation (videos, tweets, comments, playlists)
  - audit logs
  - feed-topic seeding

## Auth and Role Middleware
- Global middleware chain:
  - `verifyJwt`
  - `ensureAdminPanelEnabled`
  - `verifyAdmin`
- Route-level role gates:
  - `MODERATOR+`: `MODERATOR | ADMIN | SUPER_ADMIN`
  - `ADMIN+`: `ADMIN | SUPER_ADMIN`
  - `SUPER_ADMIN`: only `SUPER_ADMIN`

## Endpoints
- Admin identity:
  - `GET /me`
- Dashboard:
  - `GET /dashboard/overview`
  - `GET /dashboard/activity`
- Feed topics:
  - `POST /feed/topics/seed` (`ADMIN+`)
- Reports:
  - `GET /reports`
  - `GET /reports/:reportId`
  - `PATCH /reports/:reportId/resolve` (`MODERATOR+`)
- Users:
  - `GET /users`
  - `GET /users/:userId`
  - `PATCH /users/:userId/status` (`MODERATOR+`)
  - `PATCH /users/:userId/verify-pending-email` (`ADMIN+`)
  - `PATCH /users/:userId/soft-delete` (`ADMIN+`)
  - `PATCH /users/:userId/restore` (`ADMIN+`)
  - `PATCH /users/:userId/role` (`SUPER_ADMIN`)
- Videos:
  - `GET /videos`
  - `GET /videos/:videoId`
  - `PATCH /videos/:videoId/unpublish` (`MODERATOR+`)
  - `PATCH /videos/:videoId/publish` (`MODERATOR+`)
  - `PATCH /videos/:videoId/soft-delete` (`MODERATOR+`)
  - `PATCH /videos/:videoId/restore` (`MODERATOR+`)
- Tweets:
  - `GET /tweets`
  - `GET /tweets/:tweetId`
  - `PATCH /tweets/:tweetId/soft-delete` (`MODERATOR+`)
  - `PATCH /tweets/:tweetId/restore` (`MODERATOR+`)
- Comments:
  - `GET /comments`
  - `GET /comments/:commentId`
  - `PATCH /comments/:commentId/soft-delete` (`MODERATOR+`)
  - `PATCH /comments/:commentId/restore` (`MODERATOR+`)
- Playlists:
  - `GET /playlists`
  - `GET /playlists/:playlistId`
  - `PATCH /playlists/:playlistId/soft-delete` (`MODERATOR+`)
  - `PATCH /playlists/:playlistId/restore` (`MODERATOR+`)
- Audit logs (`ADMIN+`):
  - `GET /audit-logs`
  - `GET /audit-logs/:logId`

## Request Contracts
- Dashboard query:
  - `period`: `7d | 30d | 90d | 1y`
- List endpoints common query:
  - `page`, `limit`
  - `sortBy`, `sortType`
  - optional search/filter fields (below)

## List Filter Reference
- `GET /reports`:
  - `status`: `PENDING | REVIEWED | REJECTED | ACTION_TAKEN`
  - `targetType`: `VIDEO | COMMENT | USER | CHANNEL`
  - `q`, `from`, `to`
- `GET /users`:
  - `q`
  - `role`: `USER | MODERATOR | ADMIN | SUPER_ADMIN`
  - `status`: `ACTIVE | RESTRICTED | SUSPENDED`
  - `isDeleted`: boolean
- `GET /videos`:
  - `q`, `ownerId`
  - `isShort`, `isPublished`, `isDeleted`
  - `processingStatus`: `PENDING | PROCESSING | COMPLETED | FAILED | CANCELLED`
- `GET /tweets`:
  - `q`, `ownerId`, `isDeleted`
- `GET /comments`:
  - `q`, `ownerId`, `videoId`, `isDeleted`
- `GET /playlists`:
  - `q`, `ownerId`, `isDeleted`, `isPublic`
- `GET /audit-logs`:
  - `actorId`, `action`, `targetType`, `targetId`, `from`, `to`

## Mutation Body Contracts
- Most moderation actions use:

```json
{
  "reason": "optional text up to 500 chars"
}
```

- `PATCH /users/:userId/status`:

```json
{
  "status": "ACTIVE",
  "reason": "optional"
}
```

- `PATCH /users/:userId/role` (`SUPER_ADMIN` only):

```json
{
  "role": "ADMIN",
  "reason": "optional"
}
```

- `PATCH /reports/:reportId/resolve`:

```json
{
  "status": "REVIEWED",
  "note": "optional text up to 2000 chars",
  "action": {
    "type": "VIDEO_UNPUBLISH",
    "targetType": "VIDEO",
    "targetId": "entity-id",
    "payload": {
      "reason": "optional"
    }
  }
}
```

- supported report action types:
  - `USER_SET_STATUS`
  - `USER_SOFT_DELETE`
  - `USER_RESTORE`
  - `USER_VERIFY_PENDING_EMAIL`
  - `VIDEO_UNPUBLISH`
  - `VIDEO_PUBLISH`
  - `VIDEO_SOFT_DELETE`
  - `VIDEO_RESTORE`
  - `TWEET_SOFT_DELETE`
  - `TWEET_RESTORE`
  - `COMMENT_SOFT_DELETE`
  - `COMMENT_RESTORE`
  - `PLAYLIST_SOFT_DELETE`
  - `PLAYLIST_RESTORE`

## Response Data Shape
- List routes return normalized payload:
  - `items[]`
  - `pagination{}`
- Detail routes return rich object snapshots (owner summary, stats, moderation fields).
- Dashboard routes return period/dateRange with totals and chart/series blocks.
- `GET /me` returns:
  - `admin` profile
  - role-based `permissions[]`

## Frontend/Admin Panel Notes
- Always send explicit role-appropriate actions from admin UI.
- Use list filters instead of client-side filtering for large admin data sets.
- Show server error message for permission failures (`403`) and invalid filters (`400`).
