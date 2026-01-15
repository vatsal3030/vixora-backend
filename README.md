# 🎬 Vixora Backend API

<div align="center">

![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-4.x-000000?style=for-the-badge&logo=express&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-14+-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-5.x-2D3748?style=for-the-badge&logo=prisma&logoColor=white)

**Production-grade backend API for a YouTube-like video streaming platform**

[Live API](https://vixora-backend-ysg8.onrender.com) • [Frontend](https://app.vixora.co.in) • [Documentation](#-api-documentation)

</div>

---

## 📋 Table of Contents

- [Overview](#-overview)
- [Tech Stack](#-tech-stack)
- [Features](#-features)
- [Architecture](#-architecture)
- [Getting Started](#-getting-started)
- [Environment Variables](#-environment-variables)
- [Database Schema](#-database-schema)
- [API Documentation](#-api-documentation)
- [Deployment](#-deployment)
- [Contributing](#-contributing)

---

## 🌟 Overview

Vixora Backend is a **scalable, production-ready REST API** built for a modern video streaming platform. It handles everything from user authentication to video management, playlists, subscriptions, and real-time notifications.

### Key Highlights

✅ **JWT-based authentication** with refresh tokens  
✅ **Google OAuth 2.0** integration  
✅ **Cloudinary** for video & image storage  
✅ **Email OTP verification** via Brevo SMTP  
✅ **Soft delete** for users and videos  
✅ **Watch Later** using playlist architecture  
✅ **Notification system** with read/unread states  
✅ **Cron jobs** for background tasks  
✅ **Prisma ORM** for type-safe database access  

---

## 🛠 Tech Stack

### Core Technologies

| Technology | Purpose | Version |
|------------|---------|---------|
| **Node.js** | JavaScript runtime | 18+ |
| **Express.js** | Web framework | 4.x |
| **PostgreSQL** | Primary database | 14+ |
| **Prisma ORM** | Database toolkit | 5.x |

### Authentication & Security

- **JWT** - Access & refresh tokens
- **Google OAuth 2.0** - Social login
- **bcrypt** - Password hashing
- **HTTP-only cookies** - Secure token storage
- **CORS** - Cross-origin protection

### Cloud Services

- **Cloudinary** - Video & image CDN
- **Brevo (Sendinblue)** - Email service
- **Neon DB** - Serverless PostgreSQL
- **Render** - Backend hosting

---

## ✨ Features

### 🔐 Authentication & User Management

- **Registration** with email OTP verification
- **Login** via email/password or Google OAuth
- **JWT authentication** with access & refresh tokens
- **Password reset** with OTP
- **Soft account deletion** (7-day recovery window)
- **Profile management** (avatar, cover image, bio)
- **Channel customization** (description, links, category)

### 🎥 Video Management

- **Upload videos** with thumbnails to Cloudinary
- **CRUD operations** on videos
- **Visibility control** (Public, Private, Unlisted)
- **Soft delete & restore** videos
- **View count tracking**
- **Video metadata** (title, description, duration, tags)
- **Owner-based access control**

### 📂 Playlists

- **Create, update, delete** playlists
- **Public & private** playlists
- **Add/remove videos** from playlists
- **Watch Later** (special playlist)
- **Playlist metadata**:
  - Video count
  - Total duration
  - Last updated timestamp
- **Stack-based ordering** (newest first)

> **Design Decision**: Watch Later uses the playlist model instead of a separate table for consistency and reduced complexity.

### 🔔 Notifications

- **Real-time notifications** for:
  - New video uploads from subscribed channels
  - New subscriptions
  - Comments and likes
- **Read/unread state** management
- **Pagination support**
- **Notification preferences** (ALL, PERSONALIZED, NONE)

### 🔗 Subscriptions

- **Subscribe/unsubscribe** to channels
- **Notification levels**:
  - `ALL` - All uploads
  - `PERSONALIZED` - Recommended uploads
  - `NONE` - No notifications
- **Subscriber count** tracking
- **Subscription feed**

### 📊 Watch History

- **Track video progress**
- **Resume playback** from last position
- **Watch count** tracking
- **Continue watching** feed

### 💬 Comments & Likes

- **Comment on videos**
- **Like videos & comments**
- **Nested comment support** (future)
- **Comment moderation** (soft delete)

### 🐦 Community Posts (Tweets)

- **Create text + image posts**
- **Like & comment** on posts
- **User timeline**
- **Soft delete** support

---

## 🏗 Architecture

### Project Structure

```
Backend/
├── src/
│   ├── controllers/          # Business logic
│   │   ├── auth.controller.js
│   │   ├── video.controller.js
│   │   ├── playlist.controller.js
│   │   ├── subscription.controller.js
│   │   └── notification.controller.js
│   ├── routes/               # API routes
│   │   ├── auth.routes.js
│   │   ├── video.routes.js
│   │   ├── playlist.routes.js
│   │   └── index.js
│   ├── middlewares/          # Custom middlewares
│   │   ├── auth.middleware.js
│   │   ├── error.middleware.js
│   │   └── multer.middleware.js
│   ├── utils/                # Helper functions
│   │   ├── ApiResponse.js
│   │   ├── ApiError.js
│   │   ├── asyncHandler.js
│   │   ├── cloudinary.js
│   │   ├── jwt.js
│   │   └── otp.js
│   ├── cron/                 # Background jobs
│   │   └── notificationCron.js
│   ├── db/
│   │   └── prisma.js         # Prisma client
│   ├── app.js                # Express app setup
│   ├── index.js              # Server entry point
│   └── constants.js          # App constants
├── prisma/
│   ├── schema.prisma         # Database schema
│   └── migrations/           # Migration history
├── .env.example              # Environment template
├── package.json
└── README.md
```

### Request Flow

```
Client Request
    ↓
CORS Middleware
    ↓
Body Parser
    ↓
Route Handler
    ↓
Auth Middleware (if protected)
    ↓
Controller
    ↓
Prisma ORM
    ↓
PostgreSQL Database
    ↓
Response (ApiResponse/ApiError)
    ↓
Error Handler (if error)
    ↓
Client Response
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** >= 18.x
- **PostgreSQL** >= 14
- **npm** or **yarn**
- **Cloudinary account**
- **Brevo SMTP account**
- **Google OAuth credentials** (optional)

### Installation

1. **Clone the repository**

```bash
git clone https://github.com/yourusername/vixora-backend.git
cd vixora-backend
```

2. **Install dependencies**

```bash
npm install
```

3. **Set up environment variables**

```bash
cp .env.example .env
# Edit .env with your configuration
```

4. **Set up the database**

```bash
# Push schema to database (development)
npm run db:push

# Or run migrations (production)
npm run db:migrate
```

5. **Start the development server**

```bash
npm run dev
```

The API will be available at `http://localhost:10000`

### Development Commands

```bash
# Start development server with hot reload
npm run dev

# Start production server
npm start

# Run Prisma Studio (database GUI)
npm run db:studio

# Create a new migration
npm run db:migrate

# Push schema changes (dev only)
npm run db:push

# Generate Prisma Client
npm run db:generate
```

---

## 🔐 Environment Variables

Create a `.env` file in the root directory:

```env
# Server
NODE_ENV=development
PORT=10000
CORS_ORIGIN=http://localhost:5173

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/vixora

# JWT
ACCESS_TOKEN_SECRET=your_access_token_secret_here
ACCESS_TOKEN_EXPIRY=15m
REFRESH_TOKEN_SECRET=your_refresh_token_secret_here
REFRESH_TOKEN_EXPIRY=7d

# Cloudinary
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

# Email (Brevo)
BREVO_API_KEY=your_brevo_api_key
BREVO_SENDER_EMAIL=noreply@vixora.com
BREVO_SENDER_NAME=Vixora

# Google OAuth (Optional)
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_CALLBACK_URL=http://localhost:10000/api/v1/auth/google/callback

# Frontend URL
FRONTEND_URL=http://localhost:5173
```

---

## 🗄 Database Schema

### Core Models

#### User
- Authentication (email, password, OAuth)
- Profile (avatar, cover, bio)
- Channel info (description, links, category)
- Soft delete support

#### Video
- Video file & thumbnail URLs
- Metadata (title, description, duration)
- Visibility (public, private, unlisted)
- View count & engagement metrics
- Soft delete support

#### Playlist
- Name, description, privacy
- Video count & total duration
- Special flag for Watch Later
- Soft delete support

#### Subscription
- Subscriber ↔ Channel relationship
- Notification level preference
- Timestamps

#### Notification
- Type (upload, subscription, comment, like)
- Read/unread state
- Sender & recipient
- Related video/comment

#### WatchHistory
- Video progress tracking
- Watch count
- Last watched timestamp

### Relationships

```
User ──┬── Videos (1:N)
       ├── Playlists (1:N)
       ├── Subscriptions (N:N)
       ├── Comments (1:N)
       ├── Likes (1:N)
       ├── Tweets (1:N)
       └── Notifications (1:N)

Video ──┬── Comments (1:N)
        ├── Likes (1:N)
        ├── PlaylistVideos (N:N)
        └── WatchHistory (1:N)

Playlist ── PlaylistVideos (1:N)
```

---

## 📡 API Documentation

### Base URL

```
Production: https://vixora-backend-ysg8.onrender.com/api/v1
Development: http://localhost:10000/api/v1
```

### Authentication Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/auth/register` | Register new user | ❌ |
| POST | `/auth/verify-otp` | Verify email OTP | ❌ |
| POST | `/auth/login` | Login user | ❌ |
| POST | `/auth/logout` | Logout user | ✅ |
| POST | `/auth/refresh-token` | Refresh access token | ❌ |
| GET | `/auth/google` | Google OAuth login | ❌ |
| POST | `/auth/forgot-password` | Request password reset | ❌ |
| POST | `/auth/reset-password` | Reset password with OTP | ❌ |

### User Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/users/profile` | Get current user | ✅ |
| PATCH | `/users/profile` | Update profile | ✅ |
| PATCH | `/users/avatar` | Update avatar | ✅ |
| PATCH | `/users/cover-image` | Update cover | ✅ |
| DELETE | `/users/account` | Soft delete account | ✅ |

### Video Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/videos` | Get all videos | ❌ |
| GET | `/videos/:id` | Get video by ID | ❌ |
| POST | `/videos` | Upload video | ✅ |
| PATCH | `/videos/:id` | Update video | ✅ |
| DELETE | `/videos/:id` | Delete video | ✅ |
| GET | `/videos/user/:userId` | Get user videos | ❌ |

### Playlist Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/playlists` | Get user playlists | ✅ |
| GET | `/playlists/:id` | Get playlist by ID | ❌ |
| POST | `/playlists` | Create playlist | ✅ |
| PATCH | `/playlists/:id` | Update playlist | ✅ |
| DELETE | `/playlists/:id` | Delete playlist | ✅ |
| POST | `/playlists/:id/videos` | Add video | ✅ |
| DELETE | `/playlists/:id/videos/:videoId` | Remove video | ✅ |
| POST | `/playlists/watch-later/toggle` | Toggle Watch Later | ✅ |

### Subscription Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/subscriptions/:channelId` | Toggle subscription | ✅ |
| GET | `/subscriptions/channels` | Get subscribed channels | ✅ |
| GET | `/subscriptions/subscribers` | Get subscribers | ✅ |

### Notification Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/notifications` | Get notifications | ✅ |
| PATCH | `/notifications/:id/read` | Mark as read | ✅ |
| PATCH | `/notifications/read-all` | Mark all as read | ✅ |

---

## 🚢 Deployment

### Production Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Configure production database URL
- [ ] Set secure JWT secrets
- [ ] Configure CORS for production domain
- [ ] Set up Cloudinary production account
- [ ] Configure email service
- [ ] Run database migrations
- [ ] Set up SSL/HTTPS
- [ ] Configure environment variables
- [ ] Set up monitoring & logging
- [ ] Configure backup strategy

### Deploy to Render

1. Create new Web Service on Render
2. Connect GitHub repository
3. Set build command: `npm install && npm run db:generate`
4. Set start command: `npm start`
5. Add environment variables
6. Deploy

### Deploy with Docker

```bash
# Build image
docker build -t vixora-backend .

# Run container
docker run -p 10000:10000 --env-file .env vixora-backend
```

---

## 🧪 Testing

```bash
# Run tests (when implemented)
npm test

# Run tests with coverage
npm run test:coverage
```

---

## 📝 Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the ISC License.

---

## 👥 Authors

- **Your Name** - [GitHub](https://github.com/yourusername)

---

## 🙏 Acknowledgments

- Express.js team
- Prisma team
- Cloudinary
- Brevo (Sendinblue)
- All contributors

---

<div align="center">

**Made with ❤️ for the Vixora community**

[⬆ Back to Top](#-vixora-backend-api)

</div>
