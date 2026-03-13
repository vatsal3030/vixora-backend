# Upload Routes

## Base
- `/api/v1/upload`

## Route File
- `src/routes/upload.routes.js`

## Controllers
- `createUploadSession`
- `cancelUploadSession`
- `getUploadSignature`
- `updateUploadProgress`
- `finalizeUpload`

## Purpose
- Secure, session-based media upload orchestration for video publishing.

## Endpoints
- `POST /session`
- `PATCH /session/:sessionId/cancel`
- `GET /signature`
- `PATCH /progress/:sessionId`
- `POST /finalize/:sessionId`

## Key Request Structures
- Create session body:

```json
{
  "fileName": "sample.mp4",
  "fileSize": 12345678,
  "mimeType": "video/mp4",
  "uploadType": "video"
}
```

- Signature query:
  - `resourceType` (ex: `video`, `thumbnail`)

- Progress body:

```json
{
  "uploadedBytes": 5242880
}
```

- Finalize body (minimum):

```json
{
  "title": "Video title",
  "description": "Video description",
  "publicId": "videos/<user>/<cloudinary-id>",
  "thumbnailPublicId": "thumbnails/<user>/<cloudinary-id>"
}
```

Optional finalize fields:
- `duration`, `width`, `height`, `isShort`
- `tags`
- category input (`category`, `categories`, `categoryId`, `categorySlug`, etc.)
- transcript input (`transcript`, `transcriptText`, `transcriptCues`, `language`, `source`)

## Response
- Session/signature/progress/finalize responses are wrapped in `ApiResponse`.
- Finalize returns created video payload + processing status metadata.

## Frontend Notes
- Follow strict sequence: session -> signature -> upload -> progress -> finalize.
- Do not finalize with missing required IDs.
- Use active/valid category values; backend can resolve/seed missing categories by latest behavior.
