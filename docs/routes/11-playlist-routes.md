# Playlist Routes

## Base
- `/api/v1/playlists`

## Route File
- `src/routes/playlist.routes.js`

## Controllers
- Playlist CRUD: `createPlaylist`, `updatePlaylist`, `deletePlaylist`, `getPlaylistById`
- Listing/trash: `getUserPlaylists`, `getDeletedPlaylists`, `restorePlaylist`
- Playlist videos: `addVideoToPlaylist`, `removeVideoFromPlaylist`
- Visibility: `togglePlaylistPublishStatus`
- Watch later: `toggleWatchLater`, `getWatchLaterVideos`

## Endpoints
- Watch later:
  - `POST /watch-later/:videoId`
  - `GET /watch-later`
- CRUD:
  - `POST /`
  - `GET /user/me`
  - `GET /user/:userId`
  - `GET /:playlistId`
  - `PATCH /:playlistId`
  - `DELETE /:playlistId`
- Trash:
  - `GET /trash/me`
  - `PATCH /:playlistId/restore`
- Playlist videos:
  - `PATCH /add/:videoId/:playlistId`
  - `PATCH /remove/:videoId/:playlistId`
- Visibility:
  - `PATCH /:playlistId/toggle-visibility`

## Request Structures
- Create playlist body:

```json
{
  "name": "Road Trip",
  "description": "Optional",
  "isPublic": false
}
```

- Update playlist body:

```json
{
  "name": "Updated name",
  "description": "Updated description"
}
```

## Response
- Wrapped in `ApiResponse`.
- List endpoints return paginated `items + pagination`.

## Frontend Notes
- All routes are authenticated.
- Keep route ordering in mind when testing dynamic IDs.
