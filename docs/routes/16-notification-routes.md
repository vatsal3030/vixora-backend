# Notification Routes

## Base
- `/api/v1/notifications`

## Route File
- `src/routes/notification.routes.js`

## Controller File
- `src/controllers/notification.controller.js`

## Purpose
- Fetch notification list/counters.
- Mark read state.
- Delete single/all notifications.
- Return clickable notification target metadata for frontend redirection.

## Auth and Middleware
- All notification endpoints require JWT (`verifyJwt`).

## Endpoints
- `GET /`
- `GET /unread-count`
- `GET /unread`
- `PATCH /:notificationId/read`
- `PATCH /read-all`
- `DELETE /:notificationId`
- `DELETE /`

## Request Contracts
- `GET /` and `GET /unread` query:
  - `page`, `limit`
  - `isRead`: boolean (only for `GET /`; `GET /unread` forces unread)
  - `type`: `COMMENT | LIKE | SUBSCRIPTION | UPLOAD | MENTION | SYSTEM`
  - `channelId`: sender channel/user id
  - `q`: text search in title/message/sender fields
  - `from`, `to`: ISO date filters
  - `sortBy`: `createdAt | type | isRead` (`time` alias maps to `createdAt`)
  - `sortType`: `asc | desc`
- `GET /unread-count` supports same filter query and always applies unread-only.
- `PATCH /:notificationId/read` path:
  - `notificationId` (must belong to current user)

## Response Data Shape
- List endpoints return normalized payload with filters:

```json
{
  "items": [
    {
      "id": "notificationId",
      "type": "UPLOAD",
      "title": "New post",
      "message": "Channel uploaded: \"Video title\"",
      "isRead": false,
      "createdAt": "ISO_DATE",
      "target": {
        "type": "VIDEO",
        "id": "videoId",
        "url": "/watch/videoId",
        "fallbackUrls": ["/videos/videoId"],
        "isClickable": true
      },
      "targetType": "VIDEO",
      "targetId": "videoId",
      "targetUrl": "/watch/videoId",
      "isClickable": true,
      "data": {
        "target": {},
        "targetType": "VIDEO",
        "targetId": "videoId",
        "targetUrl": "/watch/videoId"
      },
      "sender": {},
      "video": {}
    }
  ],
  "pagination": {},
  "filters": {}
}
```

- `GET /unread-count` data:

```json
{
  "unreadCount": 5,
  "filters": {}
}
```

- Mutation responses:
  - `PATCH /:notificationId/read` -> `{}` with success message.
  - `PATCH /read-all` -> `{}` with success message.
  - `DELETE /:notificationId` -> `{}` with success message.
  - `DELETE /` -> `{ "deletedCount": <number> }`.

## Clickable Target Rules
- Backend always tries to resolve a redirect target from notification data:
  - video/short -> `/watch/:videoId`
  - tweet -> `/tweets/:tweetId`
  - playlist -> `/playlists/:playlistId`
  - channel -> `/channels/:channelId`
  - comment on video -> `/watch/:videoId?comment=:commentId`
- Frontend should use `target.url` first, then `target.fallbackUrls`, and only then no-op.

## Frontend Notes
- Use notification `target` object for navigation; avoid hardcoded route reconstruction.
- UI can rely on both nested `data.target` and flat `targetType/targetId/targetUrl` for compatibility.
