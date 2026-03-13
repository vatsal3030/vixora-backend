# Settings Routes

## Base
- `/api/v1/settings`

## Route File
- `src/routes/settings.routes.js`

## Controller File
- `src/controllers/settings.controller.js`

## Purpose
- Read/update/reset user-level settings that drive profile visibility, notifications, playback, and recommendation preferences.

## Auth and Middleware
- All settings endpoints require JWT (`verifyJwt`).

## Endpoints
- `GET /`
- `PATCH /`
- `POST /reset`

## Request Contracts
- `GET /`: no body/query required.
- `PATCH /` body:
  - partial updates allowed.
  - at least one valid field required.
  - payload is strict (unknown keys rejected).

```json
{
  "profileVisibility": "PUBLIC",
  "showSubscriptions": true,
  "showLikedVideos": true,
  "allowComments": true,
  "allowMentions": true,
  "emailNotifications": true,
  "commentNotifications": true,
  "subscriptionNotifications": true,
  "systemAnnouncements": true,
  "autoplayNext": true,
  "defaultPlaybackSpeed": 1.0,
  "saveWatchHistory": true,
  "showProgressBar": true,
  "showViewCount": true,
  "showVideoDuration": true,
  "showChannelName": true,
  "personalizeRecommendations": true,
  "showTrending": true,
  "hideShorts": false
}
```

- Validation rules:
  - `profileVisibility`: `PUBLIC | PRIVATE`
  - booleans accept boolean input (and `"true"/"false"` coercion)
  - `defaultPlaybackSpeed`: number `0.25` to `3`

## Response Data Shape
- `GET /` and `PATCH /` return full `userSettings` record.
- `POST /reset` returns full settings object reset to backend defaults.

## Default Settings (Reset Baseline)
- profile: public
- notifications: all enabled
- playback: autoplay on, speed `1.0`
- recommendations: personalized and trending enabled
- shorts hidden: false

## Frontend Notes
- After `PATCH` or `POST /reset`, replace local settings state with response data.
- Do not send unknown keys in `PATCH`; schema is strict.
