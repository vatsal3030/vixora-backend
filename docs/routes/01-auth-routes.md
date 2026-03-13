# Auth Routes

## Base
- `/api/v1/auth`

## Route File
- `src/routes/auth.routes.js`

## Controllers
- `googleAuth`
- `googleAuthCallback`

## Purpose
- Handles OAuth initiation + callback redirection flow.

## Endpoints
- `GET /google`
- `GET /google/callback`

## Request Notes
- No JSON body required.
- Browser redirect flow expected (not normal XHR-only flow).
- Rate-limited by route-level limiter.

## Response Behavior
- Typically redirect-based behavior (success/failure redirects), not plain JSON contract for all states.
- On callback success, auth cookies/session are established according to backend configuration.

## Frontend Notes
- Trigger via browser navigation.
- Handle redirect target query params for error cases.
