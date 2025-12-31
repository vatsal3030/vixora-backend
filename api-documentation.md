# API Documentation

## Base URL
http://localhost:5000/api/v1

## Authentication
Protected routes require:
Authorization: Bearer <ACCESS_TOKEN>

---

## Auth Routes

### POST /users/register
Register a new user

### POST /users/login
Login user and return access & refresh token

### POST /users/logout
Logout user

### GET /users/current-user
Get logged-in user info

### PATCH /users/update-account
Update user profile info

### PATCH /users/change-password
Change user password

### PATCH /users/avatar
Update profile avatar

### PATCH /users/cover-image
Update cover image

---

## Video Routes

### GET /videos
Get all videos (pagination, filters supported)

### GET /videos/:videoId
Get single video details

### POST /videos
Upload new video

### PATCH /videos/:videoId
Update video details

### DELETE /videos/:videoId
Delete video

### PATCH /videos/:videoId/toggle-publish
Publish / Unpublish video

---

## Comment Routes

### GET /comments/:videoId
Get comments for a video

### POST /comments/:videoId
Add comment

### PATCH /comments/:commentId
Edit comment

### DELETE /comments/:commentId
Delete comment

---

## Like Routes

### POST /likes/toggle/video/:videoId
Like or unlike a video

### POST /likes/toggle/comment/:commentId
Like or unlike a comment

### GET /likes/videos
Get all liked videos

---

## Subscription Routes

### POST /subscriptions/toggle/:channelId
Subscribe / Unsubscribe to a channel

### GET /subscriptions/subscribers/:channelId
Get subscribers of a channel

### GET /subscriptions/subscribed
Get channels the user subscribed to

---

## Playlist Routes

### POST /playlists
Create playlist

### GET /playlists/:playlistId
Get playlist

### PATCH /playlists/:playlistId
Update playlist

### DELETE /playlists/:playlistId
Delete playlist

### POST /playlists/:playlistId/videos/:videoId
Add video to playlist

### DELETE /playlists/:playlistId/videos/:videoId
Remove video from playlist

---

## Dashboard Routes

### GET /dashboard/stats
Get channel analytics

### GET /dashboard/videos
Get creator videos
