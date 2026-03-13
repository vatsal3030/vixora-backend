# Shared Contract (All Routes)

## Global Base URL
- API prefix: `/api/v1`

## Common Success Response Shape
Most controllers return `ApiResponse`:

```json
{
  "statusCode": 200,
  "success": true,
  "message": "Human readable message",
  "data": {}
}
```

## Common Error Response Shape
Errors are normalized by global error middleware:

```json
{
  "success": false,
  "message": "Validation or runtime error"
}
```

Dev mode may include:

```json
{
  "stack": "..."
}
```

## Auth Model
- Protected routes use JWT middleware.
- Token sources:
  - `Cookie: accessToken`
  - `Authorization: Bearer <token>`

## Canonical List/Pagination Shape
List endpoints should be consumed as:

```json
{
  "items": [],
  "pagination": {
    "currentPage": 1,
    "itemsPerPage": 20,
    "totalItems": 100,
    "totalPages": 5,
    "hasPrevPage": false,
    "hasNextPage": true,

    "page": 1,
    "limit": 20,
    "total": 100
  }
}
```

## Pagination Defaults (Current)
- Global sanitize fallback:
  - `limit = 20`
  - `maxLimit = 100` (unless endpoint overrides)

## Standard Frontend Integration Rules
- Always read payload from `response.data.data`.
- For lists: bind UI from `data.items` and `data.pagination`.
- Do not hardcode old alias arrays unless route explicitly returns them.
- Respect optional filters and defaults (do not send invalid enum values).

## HTTP + Content Type
- `Content-Type: application/json` for body payloads.
- Upload flows use backend-signed Cloudinary flow + finalize endpoints.
