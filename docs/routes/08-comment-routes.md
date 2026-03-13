# Comment Routes

## Base
- `/api/v1/comments`

## Route File
- `src/routes/comment.routes.js`

## Controllers
- `getVideoComments`
- `addComment`
- `updateComment`
- `deleteComment`

## Endpoints
- `GET /:videoId`
- `POST /:videoId`
- `PATCH /c/:commentId`
- `DELETE /c/:commentId`

## Request Structures
- Create/update body:

```json
{
  "content": "Comment text"
}
```

- List query:
- `page`, `limit`, `sortType`

## Response
- Wrapped in `ApiResponse`.
- Comment lists are paginated list payloads.

## Frontend Notes
- `GET` is optional-auth (returns personalized flags when user available).
- Mutations require authentication.
- Enforce max content length client-side to reduce 400s.
