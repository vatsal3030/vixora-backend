# Video Routes

## Base
- `/api/v1/videos`

## Route File
- `src/routes/video.routes.js`

## Controllers
- Listing/read: `getAllVideos`, `getMyVideos`, `getUserVideos`, `getVideoById`
- Mutations: `updateVideo`, `togglePublishStatus`, `deleteVideo`, `restoreVideo`
- Processing: `getVideoProcessingStatus`, `cancelVideoProcessing`

## Endpoints
- `GET /`
- `GET /me`
- `GET /user/:userId`
- `GET /trash/me`
- `GET /:videoId`
- `PATCH /:videoId`
- `DELETE /:videoId`
- `PATCH /:videoId/publish`
- `PATCH /:videoId/restore`
- `GET /:videoId/processing-status`
- `PATCH /:videoId/cancel-processing`

## Common Query Parameters
- List endpoints: `page`, `limit`, `query`, `sortBy`, `sortType`, `isShort`
- Video detail: `quality` (`auto|max|1080p|720p|480p|360p|240p|144p`)

## Common Mutation Bodies
- Update video:

```json
{
  "title": "Updated title",
  "description": "Updated description"
}
```

## Response
- Wrapped in `ApiResponse`.
- Lists use canonical `items + pagination`.
- Video detail includes owner, tags, playback-related fields, and processing metadata.

## Frontend Notes
- Route is auth-protected.
- `DELETE` is soft-delete behavior.
- Publish and processing state must be respected before showing public playback.
