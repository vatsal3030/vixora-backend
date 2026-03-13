# Media Routes

## Base
- `/api/v1/media`

## Route File
- `src/routes/media.routes.js`

## Controllers
- `finalizeImageUpload`
- `deleteImage`

## Purpose
- Finalize profile image uploads (avatar/cover) and delete user media references.

## Endpoints
- `POST /finalize/:sessionId`
- `DELETE /:type`

## Request Structures
- Finalize body:

```json
{
  "uploadType": "avatar",
  "publicId": "avatars/<user>/<cloudinary-id>"
}
```

`uploadType` usually `avatar` or `coverImage`.

- Delete path param:
  - `type`: `avatar` or `coverImage`

## Response
- `ApiResponse` with updated user media fields or cleanup result.

## Frontend Notes
- Use upload session flow before `/media/finalize/:sessionId`.
- Keep `type` exact to supported values for delete.
