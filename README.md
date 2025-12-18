# Production Grade Backend API

## Project Setup

### Prerequisites
- Node.js >= 18.x
- PostgreSQL 14+
- npm or yarn

### Installation

1. Clone the repository
2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
# Edit .env with your configuration
```

4. Set up the database:
```bash
npm run db:push
# or for migrations
npm run db:migrate
```

### Development

Start the development server:
```bash
npm run dev
```

The API will be available at `http://localhost:5000`

### Production

Build and run for production:
```bash
npm start
```

Set the following environment variables:
- `NODE_ENV=production`
- `PORT` (default: 5000)
- `DATABASE_URL` (PostgreSQL connection string)
- `CORS_ORIGIN` (allowed origin URL)

### Database

#### Prisma Commands
- `npm run db:migrate` - Create and apply migrations
- `npm run db:push` - Push schema changes (development only)
- `npm run db:studio` - Open Prisma Studio

#### Migrations
Migrations are stored in `prisma/migrations/` and are version controlled.

### Project Structure

```
├── src/
│   ├── index.js           # Entry point
│   ├── app.js             # Express app setup
│   ├── constants.js       # Application constants
│   ├── controllers/       # Business logic
│   ├── routes/            # API routes
│   ├── middlewares/       # Custom middlewares
│   ├── models/            # Data models
│   ├── utils/             # Utility functions
│   └── db/
│       └── prisma.js      # Prisma client
├── prisma/
│   ├── schema.prisma      # Database schema
│   └── migrations/        # Database migrations
├── .env                   # Environment variables (DO NOT COMMIT)
├── .env.example           # Environment template
├── prisma.config.ts       # Prisma configuration
└── package.json
```

### API Endpoints

#### Health Check
- `GET /health` - Returns server status

#### Main
- `GET /` - Returns API status

### Error Handling

All errors are caught by the global error handler and returned in the following format:

```json
{
  "success": false,
  "message": "Error description",
  "error": "Stack trace (development only)"
}
```

### Logging

- All requests are logged with method, path, status code, and response time
- Errors are logged with full stack trace
- Development mode enables Prisma query logging

### Security

- CORS is configured and restricted to specified origins
- Input validation should be implemented in route handlers
- Use HTTPS in production
- Validate and sanitize all user inputs

### Deployment

1. Set `NODE_ENV=production`
2. Configure environment variables
3. Run migrations: `npm run db:migrate`
4. Start server: `npm start`
5. Use a process manager like PM2 or Docker

### License

ISC
