# ─── Stage 1: Builder ─────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy workspace manifests
COPY package.json package-lock.json nx.json tsconfig.base.json postcss.config.js tailwind.config.base.js ./

# Install all dependencies (devDeps needed for Nx / Next.js build)
RUN npm ci

# Copy only what this app needs from the monorepo
COPY apps/vendor-dashboard/ apps/vendor-dashboard/
COPY libs/shared/ui/ libs/shared/ui/
COPY libs/shared/data-access/ libs/shared/data-access/
COPY libs/shared/types/ libs/shared/types/

# NEXT_PUBLIC_* vars are inlined at build time — pass them via docker-compose
# build.args (they have no defaults; the build will produce empty strings if
# omitted, which is safe for local testing but wrong for a live deployment).
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN
ARG NEXT_PUBLIC_FIREBASE_API_KEY
ARG NEXT_PUBLIC_FIREBASE_APP_ID
ARG NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ARG NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
ARG NEXT_PUBLIC_FIREBASE_MESSAGING_VAPID_KEY
ARG NEXT_PUBLIC_FIREBASE_PROJECT_ID
ARG NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
ARG NEXT_PUBLIC_FIREBASE_VAPID_KEY

ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=$NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN
ENV NEXT_PUBLIC_FIREBASE_API_KEY=$NEXT_PUBLIC_FIREBASE_API_KEY
ENV NEXT_PUBLIC_FIREBASE_APP_ID=$NEXT_PUBLIC_FIREBASE_APP_ID
ENV NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=$NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ENV NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=$NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
ENV NEXT_PUBLIC_FIREBASE_MESSAGING_VAPID_KEY=$NEXT_PUBLIC_FIREBASE_MESSAGING_VAPID_KEY
ENV NEXT_PUBLIC_FIREBASE_PROJECT_ID=$NEXT_PUBLIC_FIREBASE_PROJECT_ID
ENV NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=$NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
ENV NEXT_PUBLIC_FIREBASE_VAPID_KEY=$NEXT_PUBLIC_FIREBASE_VAPID_KEY
ENV NEXT_TELEMETRY_DISABLED=1

# Build the Next.js app (output: standalone → dist/apps/vendor-dashboard/)
RUN npx nx build vendor-dashboard

# ─── Stage 2: Runner ──────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Standalone server reads PORT and HOSTNAME at runtime
ENV PORT=4201
ENV HOSTNAME=0.0.0.0

# Copy the self-contained standalone server and its bundled node_modules
COPY --from=builder /app/dist/apps/vendor-dashboard/.next/standalone/ ./

# Copy static build artifacts (CSS, JS chunks) next to the standalone server
COPY --from=builder /app/dist/apps/vendor-dashboard/.next/static/ ./.next/static/

# Copy public assets
COPY --from=builder /app/dist/apps/vendor-dashboard/public/ ./public/

EXPOSE 4201

CMD ["node", "server.js"]
