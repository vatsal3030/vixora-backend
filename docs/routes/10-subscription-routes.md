# Subscription Routes

## Base
- `/api/v1/subscriptions`

## Route File
- `src/routes/subscription.routes.js`

## Controllers
- `toggleSubscription`
- `getSubscriberCount`
- `getSubscribedChannels`
- `getSubscribedVideos`
- `getSubscriptionStatus`
- `setNotificationLevel`

## Endpoints
- `GET /`
- `POST /c/:channelId/subscribe`
- `GET /c/:channelId/subscribers/count`
- `GET /u/subscriptions`
- `PATCH /c/:channelId/notifications`
- `GET /c/:channelId/status`

## Request Structures
- Notification level body:

```json
{
  "level": "ALL"
}
```

Allowed levels: `ALL | PERSONALIZED | NONE`.

- List queries:
  - `page`, `limit` for subscribed lists

## Response
- Wrapped in `ApiResponse`.
- List responses follow canonical pagination structure.

## Frontend Notes
- Routes are authenticated.
- Keep channel-subscription bell state synced with `/notifications` setting endpoint.
