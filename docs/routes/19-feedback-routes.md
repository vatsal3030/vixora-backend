# Feedback Routes

## Base
- `/api/v1/feedback`

## Route File
- `src/routes/feedback.routes.js`

## Controller File
- `src/controllers/feedback.controller.js`

## Purpose
- Captures viewer feedback signals:
  - not interested videos
  - blocked channels
  - moderation reports
- Used by feed/search suppression and safety workflows.

## Auth and Middleware
- All feedback endpoints require JWT (`verifyJwt`).

## Endpoints
- Not interested:
  - `GET /not-interested`
  - `POST /not-interested/:videoId`
  - `DELETE /not-interested/:videoId`
- Blocked channels:
  - `GET /blocked-channels`
  - `POST /blocked-channels/:channelId`
  - `DELETE /blocked-channels/:channelId`
- Reports:
  - `POST /reports`
  - `GET /reports/me`

## Request Contracts
- `POST /not-interested/:videoId` body:

```json
{
  "reason": "optional text up to 300 chars"
}
```

- `POST /blocked-channels/:channelId`:
  - no body required.
  - cannot block own channel.
- `POST /reports` body:

```json
{
  "targetType": "VIDEO",
  "targetId": "entity-id",
  "reason": "required up to 120 chars",
  "description": "optional up to 2000 chars"
}
```

- report `targetType` allowed:
  - `VIDEO | COMMENT | USER | CHANNEL`
- list endpoints query:
  - `page`, `limit` (max `50`)

## Response Data Shape
- List endpoints return normalized list payload:
  - `GET /not-interested` -> `items[]` each row has `video` snapshot.
  - `GET /blocked-channels` -> `items[]` each row has `channel` snapshot.
  - `GET /reports/me` -> `items[]` each report has status and timestamps.
- Create/update/delete style endpoints return single object or `{}` with action message.

## Behavioral Notes
- Submitting duplicate pending report for same target returns existing pending report (does not create duplicate).
- Feedback events are recorded as `userEvent` for personalization/moderation analytics.

## Frontend Notes
- Treat feedback endpoints as preference state:
  - show "not interested" and "blocked channel" toggles from list results.
- For report form, enforce targetType enum on UI side to avoid `400 Invalid targetType`.
