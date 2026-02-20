FROM node:20-alpine AS base

WORKDIR /app

COPY package*.json ./
# Install all deps first so `postinstall` + Prisma generate can run reliably.
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate
RUN npm prune --omit=dev
COPY src ./src

ENV NODE_ENV=production
EXPOSE 10000

CMD ["npm", "start"]
