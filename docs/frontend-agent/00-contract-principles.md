# Contract Principles

## Base URL
- All APIs are under: `/api/v1`

## Authentication
- Protected routes need JWT via either:
  - cookie `accessToken`
  - `Authorization: Bearer <token>`
- Public routes may still accept auth optionally (for personalized fields).

## Standard Success Wrapper
- Most endpoints return:

```json
{
  "statusCode": 200,
  "success": true,
  "message": "Human readable message",
  "data": {}
}
```

- Frontend read rule:
  - always read payload from `response.data.data`

## Standard Error Shape
- Typical errors:

```json
{
  "success": false,
  "message": "Validation or runtime error"
}
```

- Some legacy/edge handlers may return plain `message` without full wrapper.

## Paginated List Shape
- Canonical list payload:

```json
{
  "items": [],
  "pagination": {
    "currentPage": 1,
    "page": 1,
    "itemsPerPage": 20,
    "limit": 20,
    "totalItems": 120,
    "total": 120,
    "totalPages": 6,
    "hasPrevPage": false,
    "hasNextPage": true
  }
}
```

## Default Pagination Behavior
- If endpoint does not specify custom limits:
  - default limit is normalized by backend pagination utility.
  - endpoint-specific max limits are applied (commonly `50` or `100`).

## Common Enums
- `sortType`: `asc | desc`
- `scope` (search): `all | videos | shorts | channels | tweets | playlists`
- `notification level`: `ALL | PERSONALIZED | NONE`
- `video processingStatus`: `PENDING | PROCESSING | COMPLETED | FAILED | CANCELLED`

## Frontend Safety Rules
- Never assume all endpoints have identical fields even with same resource type.
- Always null-check optional nested keys (`owner`, `video`, `target`, `transcript`).
- For feeds/search, trust backend ordering and pagination metadata.
- For soft-delete flows, use restore endpoints instead of re-create hacks.
