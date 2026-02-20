# Microservices Strategy (Free Tier Safe)

This backend can run in three service roles from the same codebase:

1. `api`: serves HTTP/WebSocket routes
2. `worker`: processes queued video jobs (BullMQ)
3. `scheduler`: runs periodic maintenance jobs

## Role Flags

Use env flags per service:

- `QUEUE_ENABLED=true|false`
- `RUN_WORKER=true|false`
- `RUN_SCHEDULER=true|false`
- `RUN_WORKER_ON_DEMAND=true|false`

Recommended for strict free-tier usage:

- API service:
  - `QUEUE_ENABLED=true`
  - `RUN_WORKER=false`
  - `RUN_SCHEDULER=false`
  - `RUN_WORKER_ON_DEMAND=false` (for dedicated worker setup)
- Dedicated worker:
  - `QUEUE_ENABLED=true`
  - only start when you really need background throughput
- Scheduler:
  - `QUEUE_ENABLED=false`
  - disabled unless scheduled tasks are required

## Redis/Cache Cost Controls

- Keep Redis disabled if not needed:
  - `REDIS_ENABLED=false`
  - `CACHE_ENABLED=false`
- If Redis is enabled:
  - prefer `REDIS_URL` only (do not mix host+port with URL)
  - keep cache TTL short for feed endpoints (`20-45s`)
  - keep `CACHE_L1_ENABLED=true` to reduce Redis command volume

## AI Cost Controls

- Gemini enabled only when `GEMINI_API_KEY` is set.
- Daily quota:
  - `AI_DAILY_MESSAGE_LIMIT=40` (default)
- fallback responses are used automatically when provider is unavailable.

## Local Practice

Use `docker-compose.microservices.yml` to run split roles locally:

```bash
docker compose -f docker-compose.microservices.yml up --build
```

Use `k8s/*.yaml` as starter manifests for Kubernetes practice.

## Docker + Prisma Build Check

Before production container deploy:

1. Build image once:
   - `docker build -t vixora-backend:test .`
2. Run health check:
   - `docker run --rm -p 10000:10000 --env-file .env vixora-backend:test`
   - then call `GET /healthz`

If migrations are pending, run:

- `npx prisma migrate deploy`

Run migrations as a release/predeploy step before rolling API/worker pods.
