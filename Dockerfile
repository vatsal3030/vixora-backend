FROM node:20-alpine AS base

WORKDIR /app

COPY package*.json ./
# Prisma `postinstall` runs `prisma generate`, so schema must exist before install.
COPY prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts

# Install all deps so `postinstall` + Prisma generate can run reliably.
RUN npm ci
RUN npm prune --omit=dev
COPY src ./src

ENV NODE_ENV=production
EXPOSE 10000

CMD ["npm", "start"]
