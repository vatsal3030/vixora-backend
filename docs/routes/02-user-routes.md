# User Routes

## Base
- `/api/v1/users`

## Route File
- `src/routes/user.routes.js`

## Controller Domains
- Registration/login/session/token
- OTP/email verification
- Password recovery
- Profile/account update
- Account switch
- Account delete/restore

## Core Endpoints
- Auth + account:
  - `POST /register`
  - `POST /login`
  - `POST /logout`
  - `POST /refresh-token`
  - `GET /current-user`
- Email verification:
  - `POST /verify-email`
  - `POST /resend-otp`
- Password reset:
  - `POST /forgot-password`
  - `POST /forgot-password/verify`
  - `POST /reset-password`
  - `POST /change-password`
- Profile:
  - `PATCH /update-account`
  - `PATCH /update-avatar`
  - `PATCH /update-coverImage`
  - `PATCH /update-description`
- Channel/user retrieval:
  - `GET /u/:username`
  - `GET /id/:userId`
- Account switching:
  - `GET /account-switch-token`
  - `POST /switch-account`
  - `POST /switch-account/resolve`
- Account lifecycle:
  - `DELETE /delete-account`
  - `PATCH /restore-account/request`
  - `PATCH /restore-account/confirm`
- Email change:
  - `POST /change-email/request`
  - `POST /change-email/confirm`
  - `POST /change-email/cancel`

## Common Request Payloads
- Register: `{ fullName, email, username, password }`
- Login: `{ email|username, password }`
- Verify email OTP: `{ identifier, otp }`
- Update account: `{ fullName?, email? }`
- Update avatar/cover: `{ avatarPublicId }`, `{ coverImagePublicId }`
- Update description: `{ channelDescription?, channelLinks? }`

## Response Shape
- Success uses `ApiResponse` with `data.user` or action-specific payload.
- Auth endpoints may also set/clear cookies.

## Frontend Notes
- Treat OTP endpoints as rate-limited.
- Use authenticated token for protected endpoints.
- Respect validation errors (`400`) from schemas.
