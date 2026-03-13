# Internal Routes

## Base
- `/api/v1/internal`

## Route File
- `src/routes/internal.routes.js`

## Controller File
- `src/controllers/internal.controller.js`

## Purpose
- Internal operational metrics endpoint for backend/runtime monitoring.
- Not intended for public frontend users.

## Auth and Middleware
- Route does not use JWT.
- Uses internal token auth inside controller:
  - `x-internal-token: <INTERNAL_METRICS_TOKEN>`
  - or `Authorization: Bearer <INTERNAL_METRICS_TOKEN>`
- Requires env var `INTERNAL_METRICS_TOKEN`.

## Endpoints
- `GET /usage`

## Request Contracts
- No body/query required.
- Must include valid internal token header.

## Response Data Shape

```json
{
  "runtime": {
    "nodeEnv": "production",
    "timezone": "system"
  },
  "flags": {
    "redisEnabled": true,
    "redisCacheEnabled": true,
    "cacheEnabled": true,
    "queueEnabled": true,
    "redisHardDisabled": false
  },
  "usage": {},
  "aiDbUsageToday": {
    "total": 0,
    "chat": 0,
    "summary": 0,
    "dayStart": "ISO_DATE"
  },
  "queue": {
    "enabled": true,
    "counts": {}
  }
}
```

## Error Cases
- `503` when `INTERNAL_METRICS_TOKEN` is not configured.
- `401` for missing/invalid token.

## Frontend Notes
- Frontend app should not call this route.
- Only internal tooling/admin-ops scripts should call this endpoint.
