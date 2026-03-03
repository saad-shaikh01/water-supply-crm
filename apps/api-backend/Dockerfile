# ─── Stage 1: Builder ─────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

# Build tools needed for native modules (bcrypt, etc.)
RUN apk add --no-cache python3 make g++

# Prevent Puppeteer (bundled with whatsapp-web.js) from downloading Chromium
# during npm ci — the runner stage supplies the system Chromium instead.
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

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

# Produce a pruned package.json + package-lock.json containing only
# production dependencies, so the runner can install a minimal set.
RUN npx nx run api-backend:prune-lockfile

# Install production deps inside the builder so native modules (bcrypt, etc.)
# are compiled for Alpine here and can be copied directly to the runner.
RUN mkdir -p /prod && \
    cp dist/apps/api-backend/package.json dist/apps/api-backend/package-lock.json /prod/ && \
    cd /prod && npm ci --omit=dev

# ─── Stage 2: Runner ──────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

# ── Chromium system dependencies ──────────────────────────────────────────────
# Required for whatsapp-web.js / Puppeteer to launch a headless browser inside
# the container. Alpine's `chromium` package installs to /usr/bin/chromium-browser.
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    udev

WORKDIR /app

ENV NODE_ENV=production
# Tell Puppeteer to use the system Chromium installed above.
# Override via CHROMIUM_PATH in .env.prod if your image ships it elsewhere.
ENV CHROMIUM_PATH=/usr/bin/chromium-browser
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Copy pre-compiled production node_modules from builder
# (avoids re-running native compilation — keeps runner image small)
COPY --from=builder /prod/node_modules ./node_modules

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
