# ─── Stage 1: Builder ─────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

# Build tools needed for native modules (bcrypt, etc.)
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy workspace manifests first — better layer caching
COPY package.json package-lock.json nx.json tsconfig.base.json ./

# Install all dependencies (devDeps required for Nx / webpack build)
RUN npm ci

# Copy application source (only what the API needs)
COPY apps/api-backend/ apps/api-backend/
COPY libs/ libs/

# Generate Prisma client
RUN npx prisma generate --schema=libs/shared/database/prisma/schema.prisma

# Compile the NestJS app → dist/apps/api-backend/main.js
RUN npx nx build api-backend

# ─── Stage 2: Runner ──────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Copy the builder's working node_modules. This keeps the image larger than a
# pruned runtime install, but it is reliable with the current Nx custom build
# target and avoids prune-lockfile failures during production builds.
COPY --from=builder /app/node_modules ./node_modules

# Copy the compiled application bundle
COPY --from=builder /app/dist/apps/api-backend/main.js ./

# Copy Prisma schema + migrations (needed for `prisma migrate deploy` on boot)
COPY --from=builder /app/libs/shared/database/prisma/schema.prisma ./prisma/schema.prisma
COPY --from=builder /app/libs/shared/database/prisma/migrations/ ./prisma/migrations/

# Generate Prisma client for this Alpine runtime environment
RUN ./node_modules/.bin/prisma generate --schema=./prisma/schema.prisma

# Persistent uploads directory — mount as a named volume in production
RUN mkdir -p uploads

EXPOSE 3000

# Run pending migrations then start the application
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy --schema=./prisma/schema.prisma && node main.js"]
