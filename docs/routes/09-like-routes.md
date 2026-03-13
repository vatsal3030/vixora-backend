# Like Routes

## Base
- `/api/v1/likes`

## Route File
- `src/routes/like.routes.js`

## Controllers
- `toggleVideoLike`
- `toggleCommentLike`
- `toggleTweetLike`
- `getLikedVideos`

## Endpoints
- `POST /toggle/v/:videoId`
- `POST /toggle/c/:commentId`
- `POST /toggle/t/:tweetId`
- `GET /videos`

## Response
- Toggle endpoints return updated like state/count context.
- `GET /videos` returns user liked videos list with pagination/filter support.

## Frontend Notes
- All routes are authenticated.
- Keep UI optimistic but reconcile with response payload.
