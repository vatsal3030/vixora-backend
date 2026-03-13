# Vixora Backend API Docs (Route-Wise)

This folder is the source-of-truth context for frontend and frontend-AI agents.

## Purpose
- Keep route contracts clean and separated by feature domain.
- Prevent wrong API paths, wrong HTTP methods, and wrong payload structures.
- Document controller intent, request shape, and response shape in one place.

## How To Use
1. Start with `00-shared-contract.md` for global response/error/pagination rules.
2. Open the specific route file by feature (`15-search-routes.md`, `14-feed-routes.md`, etc.).
3. Follow endpoint request/response shape exactly as written.

## Route Files
- `00-shared-contract.md`
- `01-auth-routes.md`
- `02-user-routes.md`
- `03-upload-routes.md`
- `04-media-routes.md`
- `05-video-routes.md`
- `06-watch-routes.md`
- `07-watch-history-routes.md`
- `08-comment-routes.md`
- `09-like-routes.md`
- `10-subscription-routes.md`
- `11-playlist-routes.md`
- `12-tweet-routes.md`
- `13-channel-routes.md`
- `14-feed-routes.md`
- `15-search-routes.md`
- `16-notification-routes.md`
- `17-dashboard-routes.md`
- `18-settings-routes.md`
- `19-feedback-routes.md`
- `20-ai-routes.md`
- `21-internal-routes.md`
- `22-admin-routes.md`

## Frontend Agent Pack
- See `docs/frontend-agent/INDEX.md` for:
  - full endpoint call matrix
  - mutation payload reference
  - response binding rules
  - worker/microservice side effects
  - UI integration recipes
