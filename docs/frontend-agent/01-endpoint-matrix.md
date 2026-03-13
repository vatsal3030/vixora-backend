# Endpoint Matrix (Call, Payload, Response)

Legend:
- `Auth`: `Public`, `Optional JWT`, `JWT`, or `Internal Token`.
- `Req`: key query/body/path requirements.
- `Res`: main `data` payload shape.

## Auth
- `GET /auth/google` | Auth: Public | Req: none | Res: redirect flow
- `GET /auth/google/callback` | Auth: Public | Req: oauth callback params | Res: redirect + auth cookies

## Users
- `POST /users/register` | Auth: Public | Req body: `fullName,email,username,password` | Res: `{}` (OTP sent/verification required)
- `POST /users/verify-email` | Auth: Public | Req body: `identifier,otp` | Res: `{}`
- `POST /users/resend-otp` | Auth: Public | Req body: `identifier` | Res: `{}`
- `POST /users/login` | Auth: Public | Req body: `email|username,password` | Res: `{ user, accountSwitch }` + cookies
- `POST /users/logout` | Auth: JWT | Req: none | Res: `{}`
- `POST /users/refresh-token` | Auth: Public/cookie | Req body optional: `refreshToken` | Res: `{ user, accountSwitch }` + cookies
- `GET /users/current-user` | Auth: JWT | Req: none | Res: user object
- `GET /users/account-switch-token` | Auth: JWT | Req: none | Res: account switch token payload
- `POST /users/switch-account` | Auth: JWT | Req body: `accountSwitchToken` | Res: `{ user, accountSwitch }`
- `POST /users/switch-account/resolve` | Auth: JWT | Req body: `tokens[]` | Res: `{ accounts: [{ token, user }] }`
- `POST /users/forgot-password` | Auth: Public | Req body: `email` | Res: `{}`
- `POST /users/forgot-password/verify` | Auth: Public | Req body: `email,otp` | Res: `{}`
- `POST /users/reset-password` | Auth: Public | Req body: `email,newPassword` (+ optional `otp` or `resetToken`) | Res: `{}`
- `POST /users/change-password` | Auth: JWT | Req body: `oldPassword,newPassword` | Res: `{}`
- `PATCH /users/update-account` | Auth: JWT | Req body: `fullName` | Res: updated user summary
- `PATCH /users/update-avatar` | Auth: JWT | Req body: `avatarPublicId` | Res: updated user
- `PATCH /users/update-coverImage` | Auth: JWT | Req body: `coverImagePublicId` | Res: updated user
- `PATCH /users/update-description` | Auth: JWT | Req body: `channelDescription?`, `channelLinks?` | Res: updated user
- `GET /users/u/:username` | Auth: JWT | Req path: `username` | Res: channel profile with subscription counts
- `GET /users/id/:userId` | Auth: JWT | Req path: `userId` | Res: user/channel profile by id
- `DELETE /users/delete-account` | Auth: JWT | Req: none | Res: `{}`
- `PATCH /users/restore-account/request` | Auth: Public | Req body: `email` or `username` | Res: `{}`
- `PATCH /users/restore-account/confirm` | Auth: Public | Req body: `email|username,otp` | Res: restored user + cookies
- `POST /users/change-email/request` | Auth: JWT | Req body: `email` | Res: `{}`
- `POST /users/change-email/confirm` | Auth: JWT | Req body: `otp` | Res: updated user
- `POST /users/change-email/cancel` | Auth: JWT | Req: none | Res: `{}`

## Upload
- `POST /upload/session` | Auth: JWT | Req body: `fileName,fileSize,mimeType,uploadType?` | Res: upload session
- `PATCH /upload/session/:sessionId/cancel` | Auth: JWT | Req path: `sessionId` | Res: `{}`
- `GET /upload/signature` | Auth: JWT | Req query: `resourceType` | Res: `{ timestamp, signature, publicId, cloudName, api_key, resourceType }`
- `PATCH /upload/progress/:sessionId` | Auth: JWT | Req body: `uploadedBytes` | Res: session + `progressPercent`
- `POST /upload/finalize/:sessionId` | Auth: JWT | Req body: video finalize payload (title/description/public IDs + metadata) | Res: created video object

## Media
- `POST /media/finalize/:sessionId` | Auth: JWT | Req body: `uploadType,publicId` | Res: updated user media fields
- `DELETE /media/:type` | Auth: JWT | Req path: `type=avatar|coverImage` | Res: cleanup result

## Videos
- `GET /videos` | Auth: JWT | Req query: `page,limit,query,sortBy,sortType,isShort,tags` | Res: paginated `items` videos
- `GET /videos/me` | Auth: JWT | Req query: `page,limit,query,isShort,includeUnpublished,sortBy,sortType,tags` | Res: paginated videos
- `GET /videos/user/:userId` | Auth: JWT | Req query: `page,limit,query,sortBy,sortType,isShort` | Res: paginated videos
- `GET /videos/trash/me` | Auth: JWT | Req query: `page,limit,sortBy,sortType,isShort` | Res: paginated deleted videos
- `GET /videos/:videoId` | Auth: JWT | Req query: `quality` | Res: full video detail with streaming + interaction fields
- `PATCH /videos/:videoId` | Auth: JWT | Req body: `title?`, `description?` | Res: updated video
- `DELETE /videos/:videoId` | Auth: JWT | Req path: `videoId` | Res: `{}`
- `PATCH /videos/:videoId/publish` | Auth: JWT | Req path: `videoId` | Res: `{ id,isPublished }`
- `PATCH /videos/:videoId/restore` | Auth: JWT | Req path: `videoId` | Res: restored video
- `GET /videos/:videoId/processing-status` | Auth: JWT | Req path: `videoId` | Res: processing status object
- `PATCH /videos/:videoId/cancel-processing` | Auth: JWT | Req path: `videoId` | Res: `{}`

## Watch
- `GET /watch/:videoId` | Auth: Optional JWT | Req query: `quality` | Res: watch payload + streaming + transcript availability
- `GET /watch/:videoId/stream` | Auth: Optional JWT | Req query: `quality` | Res: stream selection payload
- `GET /watch/:videoId/transcript` | Auth: Optional JWT | Req query: `q,from,to,fromSeconds,toSeconds,page,limit` | Res: transcript segments + metadata

## Watch History
- `GET /watch-history` | Auth: JWT | Req query: `page,limit,query,isShort,includeCompleted,sortBy,sortType` | Res: paginated continue-watching items
- `DELETE /watch-history` | Auth: JWT | Req query: `completedOnly?` | Res: `{ deletedCount, filter }`
- `POST /watch-history` | Auth: JWT | Req body: `videoId,progress,duration?` | Res: watchHistory row
- `GET /watch-history/:videoId` | Auth: JWT | Req path: `videoId` | Res: watchHistory row or null
- `DELETE /watch-history/:videoId` | Auth: JWT | Req path: `videoId` | Res: `{ videoId, deleted }`
- `POST /watch-history/bulk` | Auth: JWT | Req body: `videoIds[]` | Res: map `{ [videoId]: progressObject }`

## Comments
- `GET /comments/:videoId` | Auth: Optional JWT | Req query: `page,limit,sortType` | Res: paginated comments
- `POST /comments/:videoId` | Auth: JWT | Req body: `content` | Res: created comment
- `PATCH /comments/c/:commentId` | Auth: JWT | Req body: `content` | Res: updated comment
- `DELETE /comments/c/:commentId` | Auth: JWT | Req path: `commentId` | Res: `{}`

## Likes
- `POST /likes/toggle/v/:videoId` | Auth: JWT | Req path: `videoId` | Res: `{ status: liked|unliked }`
- `POST /likes/toggle/c/:commentId` | Auth: JWT | Req path: `commentId` | Res: `{ status: liked|unliked }`
- `POST /likes/toggle/t/:tweetId` | Auth: JWT | Req path: `tweetId` | Res: `{ status: liked|unliked }`
- `GET /likes/videos` | Auth: JWT | Req query: `page,limit,sortType` | Res: paginated liked videos

## Subscriptions
- `GET /subscriptions` | Auth: JWT | Req query: `page,limit` | Res: paginated subscribed-channel videos
- `POST /subscriptions/c/:channelId/subscribe` | Auth: JWT | Req path: `channelId` | Res: `{ status, subscriberCount }`
- `GET /subscriptions/c/:channelId/subscribers/count` | Auth: JWT | Req path: `channelId` | Res: `{ subscriberCount }`
- `GET /subscriptions/u/subscriptions` | Auth: JWT | Req query: `page,limit` | Res: paginated subscribed channels
- `PATCH /subscriptions/c/:channelId/notifications` | Auth: JWT | Req body: `level` | Res: subscription notification state
- `GET /subscriptions/c/:channelId/status` | Auth: JWT | Req path: `channelId` | Res: `{ isSubscribed, subscriptionId, notificationLevel }`

## Playlists
- `POST /playlists` | Auth: JWT | Req body: `name,description?,isPublic?` | Res: created playlist
- `GET /playlists/user/me` | Auth: JWT | Req query: `page,limit,query,sortBy,sortType` | Res: paginated playlists
- `GET /playlists/user/:userId` | Auth: JWT | Req query: same as above | Res: paginated playlists (public if not self)
- `GET /playlists/:playlistId` | Auth: JWT | Req query: `page,limit` | Res: playlist metadata + paginated videos
- `PATCH /playlists/:playlistId` | Auth: JWT | Req body: `name?`, `description?` | Res: updated playlist
- `DELETE /playlists/:playlistId` | Auth: JWT | Req path: `playlistId` | Res: `{}`
- `GET /playlists/trash/me` | Auth: JWT | Req query: `page,limit` | Res: paginated deleted playlists
- `PATCH /playlists/:playlistId/restore` | Auth: JWT | Req path: `playlistId` | Res: `{}`
- `PATCH /playlists/add/:videoId/:playlistId` | Auth: JWT | Req path: ids | Res: `{}`
- `PATCH /playlists/remove/:videoId/:playlistId` | Auth: JWT | Req path: ids | Res: `{}`
- `PATCH /playlists/:playlistId/toggle-visibility` | Auth: JWT | Req path: `playlistId` | Res: `{ isPublic }`
- `POST /playlists/watch-later/:videoId` | Auth: JWT | Req path: `videoId` | Res: `{ saved: boolean }`
- `GET /playlists/watch-later` | Auth: JWT | Req query: `page,limit` | Res: paginated watch-later videos + metadata

## Tweets
- `GET /tweets/feed` | Auth: Optional JWT | Req query: `mode,topic,page,limit,sortType` | Res: paginated tweet feed + ranking metadata
- `GET /tweets/explore` | Auth: Optional JWT | Req query: same as `/feed` | Res: same as `/feed`
- `GET /tweets/topics/hot` | Auth: Optional JWT | Req query: `q,limit,windowHours` | Res: hot topic list
- `GET /tweets/:tweetId` | Auth: Optional JWT | Req path: `tweetId` | Res: tweet detail
- `POST /tweets` | Auth: JWT | Req body: `content,imagePublicId?` | Res: created tweet
- `GET /tweets/user/:userId` | Auth: JWT | Req query: `page,limit,sortBy,sortType` | Res: paginated tweets
- `GET /tweets/trash/me` | Auth: JWT | Req query: `page,limit` | Res: paginated deleted tweets
- `PATCH /tweets/:tweetId` | Auth: JWT | Req body: `content` | Res: updated tweet
- `DELETE /tweets/:tweetId` | Auth: JWT | Req path: `tweetId` | Res: `{}`
- `PATCH /tweets/:tweetId/restore` | Auth: JWT | Req path: `tweetId` | Res: `{}`

## Channels
- `GET /channels/:channelId` | Auth: Optional JWT | Req path: `channelId` | Res: channel profile/stats
- `GET /channels/:channelId/about` | Auth: Optional JWT | Req path: `channelId` | Res: channel about payload
- `GET /channels/:channelId/videos` | Auth: Public | Req query: `sort,page,limit` | Res: paginated videos
- `GET /channels/:channelId/shorts` | Auth: Public | Req query: `sort,page,limit` | Res: paginated shorts
- `GET /channels/:channelId/playlists` | Auth: Public | Req query: `page,limit` | Res: paginated playlists
- `GET /channels/:channelId/tweets` | Auth: Public | Req query: `page,limit` | Res: paginated tweets

## Feed
- `GET /feed/tags` | Auth: Optional JWT | Req query: `page,limit,q` | Res: paginated feed tags
- `GET /feed/tags/:tagName` | Auth: Optional JWT | Req query: `page,limit,sortBy,sortType` | Res: paginated tag feed videos
- `GET /feed/home` | Auth: JWT | Req query: `page,limit,tag,sortBy,sortType` | Res: paginated home feed
- `GET /feed/subscriptions` | Auth: JWT | Req query: `page,limit,isShort` | Res: paginated subscription feed
- `GET /feed/trending` | Auth: Optional JWT | Req query: `page,limit,isShort,sortBy,sortType` | Res: paginated trending feed
- `GET /feed/shorts` | Auth: Optional JWT | Req query: `page,limit,sortBy,sortType,includeComments,commentsLimit` | Res: paginated shorts feed

## Search
- `GET /search` | Auth: Optional JWT | Req query:
  - `q|query|search`
  - `scope|type`
  - `tags,category|channelCategory,sortBy,sortType`
  - `perTypeLimit` for `scope=all`
  - `page,limit` for typed scopes
  - Res: grouped results (`scope=all`) or paginated typed list

## Notifications
- `GET /notifications` | Auth: JWT | Req query: `page,limit,isRead,type,channelId,q,from,to,sortBy,sortType` | Res: paginated notifications with `target`
- `GET /notifications/unread-count` | Auth: JWT | Req query: filters | Res: `{ unreadCount, filters }`
- `GET /notifications/unread` | Auth: JWT | Req query: `page,limit,...` | Res: paginated unread notifications
- `PATCH /notifications/:notificationId/read` | Auth: JWT | Req path: `notificationId` | Res: `{}`
- `PATCH /notifications/read-all` | Auth: JWT | Req: none | Res: `{}`
- `DELETE /notifications/:notificationId` | Auth: JWT | Req path: `notificationId` | Res: `{}`
- `DELETE /notifications` | Auth: JWT | Req: none | Res: `{ deletedCount }`

## Dashboard
- `GET /dashboard/full` | Auth: JWT | Req query: `period` + optional topVideos params | Res: `{ period, generatedAt, overview, analytics, topVideos, growth, insights }`
- `GET /dashboard/overview` | Auth: JWT | Req query: `period` | Res: overview payload
- `GET /dashboard/analytics` | Auth: JWT | Req query: `period` | Res: analytics payload
- `GET /dashboard/top-videos` | Auth: JWT | Req query: `period,page,limit,sortBy,sortOrder` | Res: paginated top videos
- `GET /dashboard/growth` | Auth: JWT | Req query: `period` | Res: growth series payload
- `GET /dashboard/insights` | Auth: JWT | Req: none | Res: insight/recommendation payload

## Settings
- `GET /settings` | Auth: JWT | Req: none | Res: user settings object
- `PATCH /settings` | Auth: JWT | Req body: partial settings fields | Res: updated settings
- `POST /settings/reset` | Auth: JWT | Req: none | Res: reset settings

## Feedback
- `GET /feedback/not-interested` | Auth: JWT | Req query: `page,limit` | Res: paginated not-interested list
- `POST /feedback/not-interested/:videoId` | Auth: JWT | Req body: `reason?` | Res: created/updated preference row
- `DELETE /feedback/not-interested/:videoId` | Auth: JWT | Req path: `videoId` | Res: `{}`
- `GET /feedback/blocked-channels` | Auth: JWT | Req query: `page,limit` | Res: paginated blocked channels
- `POST /feedback/blocked-channels/:channelId` | Auth: JWT | Req path: `channelId` | Res: created/updated block row
- `DELETE /feedback/blocked-channels/:channelId` | Auth: JWT | Req path: `channelId` | Res: `{}`
- `POST /feedback/reports` | Auth: JWT | Req body: `targetType,targetId,reason,description?` | Res: report object
- `GET /feedback/reports/me` | Auth: JWT | Req query: `page,limit` | Res: paginated reports

## AI
- `POST /ai/sessions` | Auth: JWT | Req body: `videoId?,title?` | Res: created session
- `GET /ai/sessions` | Auth: JWT | Req query: `page,limit` | Res: paginated sessions
- `DELETE /ai/sessions` | Auth: JWT | Req query: `videoId?` | Res: `{ deletedSessions, filter }`
- `PATCH /ai/sessions/:sessionId` | Auth: JWT | Req body: `title` | Res: updated session
- `DELETE /ai/sessions/:sessionId` | Auth: JWT | Req path: `sessionId` | Res: `{ sessionId, deleted }`
- `GET /ai/sessions/:sessionId/messages` | Auth: JWT | Req query: `page,limit` | Res: paginated messages + session context
- `POST /ai/sessions/:sessionId/messages` | Auth: JWT | Req body: `message` | Res: `{ userMessage, assistantMessage, reply, context, ai }`
- `DELETE /ai/sessions/:sessionId/messages` | Auth: JWT | Req query: `keepSystem?` | Res: delete summary
- `DELETE /ai/sessions/:sessionId/messages/:messageId` | Auth: JWT | Req query: `cascade?` | Res: deleted ids summary
- `GET /ai/videos/:videoId/summary` | Auth: JWT | Req path: `videoId` | Res: current summary/context
- `POST /ai/videos/:videoId/summary` | Auth: JWT | Req body: `force?` | Res: generated/fetched summary + ai metadata
- `POST /ai/videos/:videoId/ask` | Auth: JWT | Req body: `question` | Res: answer + ai metadata
- `GET /ai/videos/:videoId/transcript` | Auth: JWT | Req query: `q,from,to,fromSeconds,toSeconds,page,limit` | Res: paginated segments + transcript metadata
- `POST /ai/videos/:videoId/transcript` | Auth: JWT | Req body: transcript payload | Res: saved transcript metadata
- `DELETE /ai/videos/:videoId/transcript` | Auth: JWT | Req path: `videoId` | Res: `{ videoId, deleted }`

## Internal
- `GET /internal/usage` | Auth: Internal Token | Req header: `x-internal-token` or `Authorization Bearer` | Res: runtime/queue/redis/usage snapshot

## Admin
- `GET /admin/me` | Auth: Admin JWT | Req: none | Res: admin profile + permissions
- `GET /admin/dashboard/overview` | Auth: Admin JWT | Req query: `period` | Res: admin totals/moderation metrics
- `GET /admin/dashboard/activity` | Auth: Admin JWT | Req query: `period` | Res: activity series/totals
- `POST /admin/feed/topics/seed` | Auth: Admin+ | Req body: `topics|tags|categories|names` | Res: seeded topics/tags/categories summary
- `GET /admin/reports` | Auth: Admin JWT | Req query: paging/filter/sort | Res: paginated reports
- `GET /admin/reports/:reportId` | Auth: Admin JWT | Req path: `reportId` | Res: report detail + target snapshot + prior moderation
- `PATCH /admin/reports/:reportId/resolve` | Auth: Moderator+ | Req body: `status,note?,action?` | Res: resolved report
- `GET /admin/users` | Auth: Admin JWT | Req query: paging/filter/sort | Res: paginated users
- `GET /admin/users/:userId` | Auth: Admin JWT | Req path: `userId` | Res: user detail
- `PATCH /admin/users/:userId/status` | Auth: Moderator+ | Req body: `status,reason?` | Res: updated user
- `PATCH /admin/users/:userId/verify-pending-email` | Auth: Admin+ | Req body: `reason?` | Res: updated user
- `PATCH /admin/users/:userId/soft-delete` | Auth: Admin+ | Req body: `reason?` | Res: updated user
- `PATCH /admin/users/:userId/restore` | Auth: Admin+ | Req body: `reason?` | Res: updated user
- `PATCH /admin/users/:userId/role` | Auth: SuperAdmin | Req body: `role,reason?` | Res: updated user
- `GET /admin/videos` | Auth: Admin JWT | Req query: paging/filter/sort | Res: paginated videos
- `GET /admin/videos/:videoId` | Auth: Admin JWT | Req path: `videoId` | Res: video detail
- `PATCH /admin/videos/:videoId/unpublish` | Auth: Moderator+ | Req body: `reason?` | Res: updated video
- `PATCH /admin/videos/:videoId/publish` | Auth: Moderator+ | Req body: `reason?` | Res: updated video
- `PATCH /admin/videos/:videoId/soft-delete` | Auth: Moderator+ | Req body: `reason?` | Res: updated video
- `PATCH /admin/videos/:videoId/restore` | Auth: Moderator+ | Req body: `reason?` | Res: updated video
- `GET /admin/tweets` | Auth: Admin JWT | Req query: paging/filter/sort | Res: paginated tweets
- `GET /admin/tweets/:tweetId` | Auth: Admin JWT | Req path: `tweetId` | Res: tweet detail
- `PATCH /admin/tweets/:tweetId/soft-delete` | Auth: Moderator+ | Req body: `reason?` | Res: updated tweet
- `PATCH /admin/tweets/:tweetId/restore` | Auth: Moderator+ | Req body: `reason?` | Res: updated tweet
- `GET /admin/comments` | Auth: Admin JWT | Req query: paging/filter/sort | Res: paginated comments
- `GET /admin/comments/:commentId` | Auth: Admin JWT | Req path: `commentId` | Res: comment detail
- `PATCH /admin/comments/:commentId/soft-delete` | Auth: Moderator+ | Req body: `reason?` | Res: updated comment
- `PATCH /admin/comments/:commentId/restore` | Auth: Moderator+ | Req body: `reason?` | Res: updated comment
- `GET /admin/playlists` | Auth: Admin JWT | Req query: paging/filter/sort | Res: paginated playlists
- `GET /admin/playlists/:playlistId` | Auth: Admin JWT | Req path: `playlistId` | Res: playlist detail
- `PATCH /admin/playlists/:playlistId/soft-delete` | Auth: Moderator+ | Req body: `reason?` | Res: updated playlist
- `PATCH /admin/playlists/:playlistId/restore` | Auth: Moderator+ | Req body: `reason?` | Res: updated playlist
- `GET /admin/audit-logs` | Auth: Admin+ | Req query: paging/filter/sort/date range | Res: paginated audit logs
- `GET /admin/audit-logs/:logId` | Auth: Admin+ | Req path: `logId` | Res: audit log detail
