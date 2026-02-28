# Admin API Handoff

Last updated: 2026-02-28
Source of truth: `src/routes/admin.routes.js`, `src/controllers/admin/*`, `src/services/admin.*`

## 1) Base + Auth

- Base path: `/api/v1/admin`
- Required auth: same access token as main app (`HttpOnly` cookie `accessToken` or `Authorization: Bearer`)
- Middleware chain:
  1. `verifyJwt`
  2. `ensureAdminPanelEnabled`
  3. `verifyAdmin`

Admin panel can be disabled globally with `ADMIN_PANEL_ENABLED=false`.

## 2) Role model

- `MODERATOR`: report/content moderation, user status `ACTIVE|RESTRICTED`
- `ADMIN`: moderator + user suspend/delete/restore + pending-email verify
- `SUPER_ADMIN`: admin + role updates

Guard rule:

- Last remaining `SUPER_ADMIN` cannot be demoted.

## 3) Response shape

Standard success envelope:

```json
{
  "statusCode": 200,
  "data": {},
  "message": "Success",
  "success": true
}
```

Paginated list shape (`data`):

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

## 4) Endpoints

### 4.1 Session/Profile

- `GET /me`

Returns current admin profile + computed permissions list.

### 4.2 Dashboard

- `GET /dashboard/overview?period=7d|30d|90d|1y`
- `GET /dashboard/activity?period=7d|30d|90d|1y`

### 4.3 Reports

- `GET /reports?page&limit&status&targetType&q&sortBy&sortType&from&to`
- `GET /reports/:reportId`
- `PATCH /reports/:reportId/resolve`

Resolve body:

```json
{
  "status": "REVIEWED",
  "note": "checked",
  "action": {
    "type": "VIDEO_UNPUBLISH",
    "targetType": "VIDEO",
    "targetId": "video_uuid",
    "payload": {
      "reason": "policy violation"
    }
  }
}
```

Allowed resolve statuses:

- `REVIEWED`
- `REJECTED`
- `ACTION_TAKEN`

Supported action types:

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

### 4.4 Users moderation

- `GET /users?page&limit&q&status&role&isDeleted&sortBy&sortType`
- `GET /users/:userId`
- `PATCH /users/:userId/status`
- `PATCH /users/:userId/verify-pending-email`
- `PATCH /users/:userId/soft-delete`
- `PATCH /users/:userId/restore`
- `PATCH /users/:userId/role` (SUPER_ADMIN only)

`PATCH /users/:userId/status` body:

```json
{
  "status": "SUSPENDED",
  "reason": "spam"
}
```

`PATCH /users/:userId/role` body:

```json
{
  "role": "ADMIN",
  "reason": "promoted"
}
```

### 4.5 Videos moderation

- `GET /videos?page&limit&q&ownerId&isShort&isPublished&isDeleted&processingStatus&sortBy&sortType`
- `GET /videos/:videoId`
- `PATCH /videos/:videoId/unpublish`
- `PATCH /videos/:videoId/publish`
- `PATCH /videos/:videoId/soft-delete`
- `PATCH /videos/:videoId/restore`

### 4.6 Tweets moderation

- `GET /tweets?page&limit&q&ownerId&isDeleted&sortBy&sortType`
- `GET /tweets/:tweetId`
- `PATCH /tweets/:tweetId/soft-delete`
- `PATCH /tweets/:tweetId/restore`

### 4.7 Comments moderation

- `GET /comments?page&limit&q&ownerId&videoId&isDeleted&sortBy&sortType`
- `GET /comments/:commentId`
- `PATCH /comments/:commentId/soft-delete`
- `PATCH /comments/:commentId/restore`

### 4.8 Playlists moderation

- `GET /playlists?page&limit&q&ownerId&isDeleted&isPublic&sortBy&sortType`
- `GET /playlists/:playlistId`
- `PATCH /playlists/:playlistId/soft-delete`
- `PATCH /playlists/:playlistId/restore`

### 4.9 Audit logs

- `GET /audit-logs?page&limit&actorId&action&targetType&targetId&from&to&sortBy&sortType`
- `GET /audit-logs/:logId`

## 5) Moderation policy constraints

- Delete-style admin actions are soft-delete only.
- Restore allowed only within 7 days from `deletedAt`.
- Admin operations are audit-logged in `AdminAuditLog`.
- Sensitive fields are never returned (`password`, `refreshToken`, OTP hashes).

## 6) Interaction with non-admin APIs

`writeAccessGuard` runs during `verifyJwt`:

- Non-admin users with `moderationStatus=RESTRICTED|SUSPENDED` are blocked on mutating endpoints.
- Read endpoints continue to work.
- Exceptions allowed: logout and account-switch routes.

## 7) Required env for admin deployment

- `ADMIN_PANEL_ENABLED=true`
- `ADMIN_BOOTSTRAP_EMAILS=admin1@example.com,admin2@example.com` (recommended at first deploy)
- `ADMIN_FRONTEND_URL=https://admin.example.com` (optional but recommended if separate admin UI)
- Include admin frontend origin in `CORS_ORIGIN`.

## 8) Smoke-test sequence

1. Login as seeded admin user.
2. `GET /api/v1/admin/me`
3. `GET /api/v1/admin/dashboard/overview?period=7d`
4. `GET /api/v1/admin/reports?page=1&limit=10`
5. `GET /api/v1/admin/users?page=1&limit=10`
6. Run one content action (`/videos/:id/unpublish`) and verify:
   - action reflected in entity
   - entry created in `/admin/audit-logs`
