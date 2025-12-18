// Prisma configuration for version 7+
// Connection URLs are configured via environment variables

export default {
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
      directUrl: process.env.DIRECT_URL,
    },
  },
};
