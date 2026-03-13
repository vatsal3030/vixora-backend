# AI Routes

## Base
- `/api/v1/ai`

## Route File
- `src/routes/ai.routes.js`

## Controller File
- `src/controllers/ai.controller.js`

## Purpose
- AI chat sessions and message history.
- Video transcript management for AI context.
- Video summary generation.
- Direct video Q&A.

## Auth and Middleware
- All endpoints require JWT (`verifyJwt`).
- Mutating and generation-heavy endpoints are protected by `aiLimiter`.

## Endpoints
- Session lifecycle:
  - `POST /sessions` (rate-limited)
  - `GET /sessions`
  - `DELETE /sessions` (rate-limited)
  - `PATCH /sessions/:sessionId` (rate-limited)
  - `DELETE /sessions/:sessionId` (rate-limited)
- Session messages:
  - `GET /sessions/:sessionId/messages`
  - `POST /sessions/:sessionId/messages` (rate-limited)
  - `DELETE /sessions/:sessionId/messages` (rate-limited)
  - `DELETE /sessions/:sessionId/messages/:messageId` (rate-limited)
- Video AI routes:
  - `GET /videos/:videoId/summary`
  - `POST /videos/:videoId/summary` (rate-limited)
  - `POST /videos/:videoId/ask` (rate-limited)
  - `GET /videos/:videoId/transcript`
  - `POST /videos/:videoId/transcript` (rate-limited)
  - `DELETE /videos/:videoId/transcript` (rate-limited)

## Request Contracts
- `POST /sessions` body:

```json
{
  "videoId": "optional-video-id",
  "title": "optional custom title"
}
```

- `GET /sessions` query: `page`, `limit` (max `50`).
- `PATCH /sessions/:sessionId` body:

```json
{
  "title": "new session title"
}
```

- `DELETE /sessions` query:
  - `videoId` optional (clear only sessions linked to this video).
- `GET /sessions/:sessionId/messages` query:
  - `page`, `limit` (max `100`)
- `POST /sessions/:sessionId/messages` body:

```json
{
  "message": "user text (required, max 1500 chars)"
}
```

- `DELETE /sessions/:sessionId/messages` query:
  - `keepSystem`: boolean, default `true`
- `DELETE /sessions/:sessionId/messages/:messageId` query:
  - `cascade`: boolean, default `true` (if deleting user message, assistant reply may be deleted too)
- `POST /videos/:videoId/summary` body:

```json
{
  "force": false
}
```

- `POST /videos/:videoId/ask` body:

```json
{
  "question": "required, max 1500 chars"
}
```

- `GET /videos/:videoId/transcript` query:
  - text/time filters: `q`, `from`, `to`, `fromSeconds`, `toSeconds`
  - pagination: `page`, `limit` (max `200`)
- `POST /videos/:videoId/transcript` body:

```json
{
  "transcript": "optional full text",
  "cues": [
    {
      "startMs": 0,
      "endMs": 2500,
      "text": "caption line"
    }
  ],
  "language": "en",
  "source": "MANUAL"
}
```

- transcript source allowed: `MANUAL | AUTO | IMPORTED` (invalid source falls back to `MANUAL`).

## Response Data Shape
- Session list/messages use normalized list payload (`items + pagination`).
- Session message send response:

```json
{
  "sessionId": "id",
  "userMessage": {},
  "assistantMessage": {},
  "reply": "assistant text",
  "answer": "assistant text",
  "context": {
    "hasTranscript": true,
    "transcriptChars": 12345,
    "hasDescription": true,
    "hasSummary": false,
    "quality": "RICH"
  },
  "ai": {
    "provider": "gemini",
    "model": "model-name",
    "warning": null,
    "quota": {},
    "confidence": 0.86,
    "citations": []
  }
}
```

- Summary endpoints return:
  - `videoId`, `summary`, `source`, `context`, `ai`, optional `quota`.
- Transcript read endpoint returns:
  - paginated `segments`
  - transcript metadata (`language`, `source`, `wordCount`, `segmentCount`)
  - applied filters.

## Access and Ownership Rules
- Session routes require ownership of the target session.
- Transcript write/delete is only allowed for video owner.
- Video summary/Q&A requires video visibility/access checks and processing readiness.

## Frontend Notes
- Prefer session-based flow for chat UI (`/sessions` + `/messages`).
- Use direct `/ask` and `/summary` for quick single-shot AI features.
- Render `ai.warning` and `ai.quota` to explain fallbacks/rate limits to users.
