# Vixora Backend — Master System Architecture & API Manual

> **Purpose**: This document is a comprehensive, deep-dive architectural and system manual for the Vixora Backend. It describes every database model, controller, route, service, middleware, background worker pipeline, and real-time mechanism to provide full context for AI agents, developers, and system architects.

---

## 1. System Overview & Technology Stack

| Layer | Technologies & Libraries |
| :--- | :--- |
| **Runtime & Framework** | Node.js (v20+ ES Modules), Express.js (v4.x) |
| **Database & ORM** | PostgreSQL (v15+), Prisma ORM (v5.x / v6.x) with Connection Pooling |
| **Cache & In-Memory Store** | In-Memory TTL Cache / Redis Adapter |
| **Real-time WebSockets** | Socket.io (v4.x) with Authenticated User Rooms |
| **Background Queues & Jobs** | BullMQ / Redis Job Queue + In-Process Asynchronous Dispatchers |
| **Media & Storage Pipeline** | Cloudinary SDK (Multi-bitrate Transcoding, HLS Master Playlists, Direct Uploads) |
| **Artificial Intelligence** | Google Gemini API (Video Summaries, Transcripts, Chaptering, AI Video Chat) |
| **Authentication & Security** | JWT (Access & Refresh Tokens in HTTP-only Cookies), Bcrypt, Express Rate Limit, Helmet, CORS, Joi Validation |
| **Email & Communications** | Nodemailer (SMTP / Gmail OTP & Activity Notifications) |

---

## 2. Directory & Architectural Structure

```
Backend/
├── prisma/
│   ├── schema.prisma              # Complete PostgreSQL Database Schema & Relations
│   └── migrations/                # Database Migration History
├── src/
│   ├── config/                    # Global Configuration & Environment Validation
│   ├── controllers/               # HTTP Request Handlers (Business Logic)
│   │   ├── admin.controller.js            # User management, moderation, audit logs
│   │   ├── ai.controller.js               # Gemini AI summaries & video chat sessions
│   │   ├── auth.controller.js             # Sign up, login, OTP, token refresh, logout
│   │   ├── channel.controller.js          # Channel profile, stats, banner & avatar
│   │   ├── comment.controller.js          # Threaded comments, replies, like counts
│   │   ├── dashboard.controller.js        # Creator studio analytics, views, subscriber graphs
│   │   ├── feed.controller.js             # Recommendation engine, tag feeds, trending
│   │   ├── feedback.controller.js         # User feedback & system reports
│   │   ├── like.controller.js             # Like/dislike for videos, comments, tweets
│   │   ├── notification.controller.js     # User notifications, mark as read, badge count
│   │   ├── playlist.controller.js         # Playlists, reordering, public/private, trash
│   │   ├── search.controller.js           # Full-text search with relevance ranking & history
│   │   ├── settings.controller.js         # User preferences, playback settings, theme
│   │   ├── subscription.controller.js     # Channel subscription toggle, subscriber feeds
│   │   ├── tweet.controller.js            # Community posts, image attachments, polls
│   │   ├── upload.controller.js           # Cloudinary direct upload session generation
│   │   ├── user.controller.js             # User account management, email change OTP
│   │   ├── video.controller.js            # Video CRUD, scoring, soft delete & 7-day restore
│   │   ├── video.processing.controller.js # Video transcoding status & cancellation
│   │   └── watchHistory.controller.js     # Continue watching progress, resume timestamps
│   ├── db/
│   │   └── prisma.js              # Prisma Client Singleton with Query Logging
│   ├── middlewares/               # Express Middlewares
│   │   ├── auth.middleware.js             # JWT verification & role validation (USER, ADMIN)
│   │   ├── error.middleware.js            # Centralized API Error Normalizer
│   │   ├── multer.middleware.js           # Memory / Disk file upload handler
│   │   └── rateLimiter.middleware.js      # Endpoint-specific rate limiters
│   ├── routes/                    # Express Routers
│   │   ├── admin.routes.js, ai.routes.js, auth.routes.js, channel.routes.js,
│   │   ├── comment.routes.js, dashboard.routes.js, feed.routes.js, feedback.routes.js,
│   │   ├── like.routes.js, notification.routes.js, playlist.routes.js, search.routes.js,
│   │   ├── settings.routes.js, subscription.routes.js, tweet.routes.js, upload.routes.js,
│   │   ├── user.routes.js, video.routes.js, watch.routes.js, watchHistory.routes.js
│   ├── services/                  # Shared Business Logic & Integrations
│   │   ├── ai.service.js                  # Gemini AI prompts & conversation context
│   │   ├── cloudinary.service.js          # File uploads, signed params, asset deletion
│   │   ├── email.service.js               # OTP email generation & HTML templates
│   │   └── notification.service.js        # Real-time WebSocket + DB notification dispatcher
│   ├── realtime/
│   │   └── socket.js              # Socket.io server, authenticated connection handler
│   ├── utils/                     # Utility Classes & Helpers
│   │   ├── ApiError.js                    # Standard Error Exception Class
│   │   ├── ApiResponse.js                 # Standard Response Wrapper Class
│   │   ├── asyncHandler.js                # Async Express Handler Wrapper
│   │   ├── pagination.js                  # Standardized Pagination Sanitizer
│   │   ├── listResponse.js                # Paginated List Response Builder
│   │   └── videoQuality.js                # HLS Multi-bitrate Stream Builder
│   ├── app.js                     # Express Application Setup, Middleware Mounts & Routes
│   └── index.js                   # Server Entry Point (HTTP + WebSocket Listening)
```

---

## 3. Database Schema Architecture (Prisma & PostgreSQL)

### Core Models & Relationships

```mermaid
erDiagram
    USER ||--o{ VIDEO : "owns"
    USER ||--o{ COMMENT : "writes"
    USER ||--o{ LIKE : "gives"
    USER ||--o{ PLAYLIST : "creates"
    USER ||--o{ SUBSCRIPTION : "subscribes/subscribers"
    USER ||--o{ TWEET : "publishes"
    USER ||--o{ WATCH_HISTORY : "tracks"
    USER ||--o{ NOTIFICATION : "receives"
    USER ||--o{ AI_CHAT_SESSION : "interacts"

    VIDEO ||--o{ VIDEO_TAG : "tagged_with"
    TAG ||--o{ VIDEO_TAG : "tags"
    VIDEO ||--o{ COMMENT : "receives"
    VIDEO ||--o{ LIKE : "receives"
    VIDEO ||--o{ PLAYLIST_VIDEO : "included_in"
    VIDEO ||--o{ WATCH_HISTORY : "recorded_in"
    VIDEO ||--o{ VIDEO_PROCESSING_JOB : "monitored_by"
    VIDEO ||--o| VIDEO_TRANSCRIPT : "has"

    COMMENT ||--o{ COMMENT : "replies (parentId)"
    COMMENT ||--o{ LIKE : "receives"
    PLAYLIST ||--o{ PLAYLIST_VIDEO : "contains"
```

### Entity Specifications

1. **`User`**:
   - `id` (UUID Primary Key), `username` (Unique), `email` (Unique), `fullName`, `avatar`, `coverImage`, `password` (Hashed), `refreshToken`.
   - `role`: Enum `[USER, ADMIN, MODERATOR]`.
   - `moderationStatus`: Enum `[ACTIVE, WARNED, SUSPENDED, BANNED]`.
   - `emailVerified` (Boolean), `otpHash`, `otpExpiresAt`, `otpAttempts`.
   - `channelDescription`, `channelLinks` (JSON).

2. **`Video`**:
   - `id` (UUID Primary Key), `title` (Max 120 chars), `description` (Max 5000 chars), `duration` (Seconds), `views` (Int).
   - `videoFile` (URL), `thumbnail` (URL), `videoPublicId`, `thumbnailPublicId`.
   - `aspectRatio`, `isShort` (Boolean, true for 9:16 portrait videos <= 60s).
   - `isPublished` (Boolean), `isDeleted` (Boolean), `deletedAt` (Soft delete with 7-day restore window).
   - `processingStatus`: Enum `[PENDING, PROCESSING, COMPLETED, FAILED]`.
   - `isHlsReady` (Boolean), `playbackUrl`, `availableQualities` (`["MAX", "1080p", "720p", "480p"]`).
   - `popularityScore` & `engagementScore`: Calculated as `views * 0.3 + likes * 0.4 + comments * 0.2 + watchHistory * 0.1`.
   - `summary` (AI-generated summary).

3. **`Comment`**:
   - `id`, `content`, `videoId`, `ownerId`, `parentId` (Self-referencing foreign key for nested replies), `isEdited`, `isPinned`.
   - Supports 10+ levels of nested recursive replies with cascade deletion on parent deletion.

4. **`Like`**:
   - `id`, `likedById`, `videoId` (Nullable), `commentId` (Nullable), `tweetId` (Nullable), `type` (`LIKE` or `DISLIKE`).

5. **`Playlist` & `PlaylistVideo`**:
   - `Playlist`: `id`, `name`, `description`, `ownerId`, `isPrivate`, `isDeleted`, `deletedAt`.
   - `PlaylistVideo`: Composite primary key `[playlistId, videoId]`, `order` (Float for drag-and-drop reordering).

6. **`Subscription`**:
   - Composite key `[subscriberId, channelId]`, notification preference enum `[ALL, PERSONALIZED, NONE]`.

7. **`WatchHistory`**:
   - Composite key `[userId, videoId]`, `progress` (Percentage 0-100), `duration` (Watched seconds), `lastWatchedAt`. Used for the **Continue Watching** feed and resume timestamps.

8. **`Tweet` (Community Posts)**:
   - `id`, `content`, `ownerId`, `mediaUrl`, `pollOptions` (JSON), `createdAt`.

---

## 4. Key Subsystems & Execution Pipelines

### 4.1 Ingestion & HLS Transcoding Pipeline
1. **Upload Initiation**: Client requests signed direct upload credentials via `POST /api/v1/upload/create-session`.
2. **Cloudinary Ingestion**: Client uploads video chunks directly to Cloudinary storage.
3. **Webhook / Callback**: Backend registers the asset, extracts duration/metadata, and triggers background transcoding.
4. **HLS Generation**: Video is converted into an adaptive HLS `.m3u8` master stream with `MAX`, `1080p`, `720p`, and `480p` resolutions.
5. **Real-time Progress Dispatch**: Socket.io emits `video:processing-progress` to the video owner until `processingStatus === 'COMPLETED'`.

### 4.2 Recommendation & Dynamic Feed Engine
- **Home Feed** (`GET /api/v1/feed/home`):
  - Fetches published, non-deleted, completed HLS videos with database-level pagination (`limit = 20`).
  - Includes user watch history progress so thumbnails display resume progress bars.
- **In-Place Tag Feed** (`GET /api/v1/feed/tags/:tagName`):
  - Queries videos indexed with the selected tag without requiring page navigation or reload.
- **Trending Feed** (`GET /api/v1/feed/trending`):
  - Ranks videos based on popularity score decay algorithm over 24-48 hours.

### 4.3 Comments & Threaded Reply Hierarchy
- Top-level comments are queried via `GET /api/v1/comments/:videoId?page=1&limit=20`.
- Each comment includes `repliesCount` and top 2 replies.
- Additional nested replies are queried on demand via `GET /api/v1/comments/:commentId/replies`.
- New replies update parent `repliesCount` automatically.

### 4.4 Real-time Notification Engine
- Handled in `src/services/notification.service.js`.
- Broadcasts real-time events via Socket.io to private user rooms (`user:<userId>`):
  - `VIDEO_UPLOADED`: Sent to all subscribed channel followers.
  - `COMMENT_ADDED` / `COMMENT_REPLIED`: Sent to video or comment owner.
  - `CHANNEL_SUBSCRIBED`: Sent to creator.
- Stores notification record in PostgreSQL for offline badge retrieval.

---

## 5. Complete API Route & Endpoint Reference

### 5.1 Authentication (`/api/v1/auth`)
| Method | Endpoint | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `POST` | `/register` | Register new user account with email & password | No |
| `POST` | `/login` | Authenticate user, set HTTP-only cookies | No |
| `POST` | `/logout` | Clear auth cookies and invalidate refresh token | Yes |
| `POST` | `/refresh-token` | Generate new access token from refresh token | No (Cookie) |
| `POST` | `/send-otp` | Send verification OTP to email | No |
| `POST` | `/verify-otp` | Verify 6-digit OTP and activate account | No |
| `POST` | `/forgot-password` | Request password reset OTP | No |
| `POST` | `/reset-password` | Reset password using verified OTP | No |

### 5.2 Videos (`/api/v1/videos`)
| Method | Endpoint | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `GET` | `/` | Fetch paginated videos feed (query, tags, sorting) (`limit=20`) | Optional |
| `GET` | `/me` | Get authenticated user's uploaded videos | Yes |
| `GET` | `/user/:userId` | Get public videos of a specific user/channel | Optional |
| `GET` | `/trash/me` | Get user's soft-deleted videos (7-day restore window) | Yes |
| `GET` | `/:videoId` | Get single video details, stream URLs, and metadata | Optional |
| `PATCH` | `/:videoId` | Update video title, description, thumbnail | Yes (Owner) |
| `DELETE` | `/:videoId` | Soft-delete video (can restore within 7 days) | Yes (Owner) |
| `PATCH` | `/:videoId/publish` | Toggle public/private visibility | Yes (Owner) |
| `PATCH` | `/:videoId/restore` | Restore soft-deleted video | Yes (Owner) |
| `GET` | `/:videoId/processing-status`| Check HLS transcoding progress | Yes (Owner) |
| `PATCH` | `/:videoId/cancel-processing`| Cancel active video transcoding job | Yes (Owner) |

### 5.3 Comments (`/api/v1/comments`)
| Method | Endpoint | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `GET` | `/:videoId` | Get top-level comments for a video (`limit=20`) | Optional |
| `POST` | `/:videoId` | Add top-level comment or nested reply (`parentId`) | Yes |
| `PATCH` | `/:commentId` | Edit comment content | Yes (Owner) |
| `DELETE` | `/:commentId` | Delete comment and all its nested replies | Yes (Owner/Admin) |
| `GET` | `/:commentId/replies` | Fetch paginated replies to a comment | Optional |

### 5.4 Likes & Dislikes (`/api/v1/likes`)
| Method | Endpoint | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `POST` | `/toggle/v/:videoId` | Toggle like/dislike on a video | Yes |
| `POST` | `/toggle/c/:commentId` | Toggle like on a comment | Yes |
| `POST` | `/toggle/t/:tweetId` | Toggle like on a tweet | Yes |
| `GET` | `/videos` | Get authenticated user's liked videos feed | Yes |

### 5.5 Playlists (`/api/v1/playlists`)
| Method | Endpoint | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `POST` | `/` | Create new playlist (public/private) | Yes |
| `GET` | `/user/:userId` | Get all playlists created by a user | Optional |
| `GET` | `/:playlistId` | Get playlist details and ordered video list | Optional |
| `PATCH` | `/:playlistId` | Update playlist title and privacy status | Yes (Owner) |
| `DELETE` | `/:playlistId` | Soft delete playlist to trash | Yes (Owner) |
| `PATCH` | `/add/:videoId/:playlistId`| Add video to playlist | Yes (Owner) |
| `PATCH` | `/remove/:videoId/:playlistId`| Remove video from playlist | Yes (Owner) |
| `PATCH` | `/:playlistId/reorder` | Reorder videos inside playlist | Yes (Owner) |

### 5.6 Subscriptions (`/api/v1/subscriptions`)
| Method | Endpoint | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `POST` | `/c/:channelId` | Toggle subscribe / unsubscribe to channel | Yes |
| `GET` | `/channels` | Get list of channels user is subscribed to | Yes |
| `GET` | `/videos` | Get aggregated feed of subscribed creators | Yes |

### 5.7 Watch History & Progress (`/api/v1/history`)
| Method | Endpoint | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `GET` | `/` | Get full paginated watch history | Yes |
| `POST` | `/progress/:videoId` | Save milestone watch percentage & timestamp | Yes |
| `GET` | `/continue-watching` | Get continue watching feed with resume timestamps | Yes |
| `DELETE` | `/clear` | Clear entire watch history | Yes |
| `DELETE` | `/:videoId` | Remove single video from history | Yes |

### 5.8 AI Video Intelligence (`/api/v1/ai`)
| Method | Endpoint | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `POST` | `/summarize/:videoId` | Generate AI summary & key takeaways | Yes |
| `POST` | `/chat/:videoId` | Ask questions to AI based on video transcript | Yes |
| `GET` | `/chat/:videoId/history` | Retrieve previous AI conversation history | Yes |

---

## 6. Environment Configuration Reference

```env
# Server
PORT=8000
NODE_ENV=development
CORS_ORIGIN=http://localhost:5173

# Database (PostgreSQL via Prisma)
DATABASE_URL=postgresql://postgres:password@localhost:5432/vixora?schema=public

# JWT Security
ACCESS_TOKEN_SECRET=your_super_secret_access_token_key_here
ACCESS_TOKEN_EXPIRY=15m
REFRESH_TOKEN_SECRET=your_super_secret_refresh_token_key_here
REFRESH_TOKEN_EXPIRY=7d

# Cloudinary Storage & Transcoding
CLOUDINARY_CLOUD_NAME=your_cloudinary_cloud_name
CLOUDINARY_API_KEY=your_cloudinary_api_key
CLOUDINARY_API_SECRET=your_cloudinary_api_secret

# AI Integration
GEMINI_API_KEY=your_google_gemini_api_key

# Email Service (Nodemailer SMTP)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_email_app_password
```

---

## 7. Developer & Agent Best Practices
1. **Always use Prisma transactions** (`prisma.$transaction`) when updating counts alongside related records.
2. **Never return raw database errors** to clients; always wrap with `new ApiError(statusCode, message)`.
3. **Maintain consistent pagination** across all endpoints using `sanitizePagination(page, limit, maxLimit)` and `buildPaginatedListData`.
4. **Preserve soft-delete safety**: Always query `where: { isDeleted: false }` for public-facing endpoints.
