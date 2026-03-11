# ─── Stage 1: Builder ─────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy workspace manifests
COPY package.json package-lock.json nx.json tsconfig.base.json postcss.config.js tailwind.config.base.js ./

# Install all dependencies (devDeps needed for Nx / Next.js build)
RUN npm ci

# Copy only what this app needs from the monorepo
COPY apps/admin-panel/ apps/admin-panel/
COPY libs/shared/ui/ libs/shared/ui/
COPY libs/shared/data-access/ libs/shared/data-access/
COPY libs/shared/types/ libs/shared/types/

# NEXT_PUBLIC_* vars are inlined at build time — pass them via docker-compose
# build.args so the browser bundle points at the public API domain.
ARG NEXT_PUBLIC_API_URL

ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_TELEMETRY_DISABLED=1

# Build the Next.js app (output: standalone → dist/apps/admin-panel/)
RUN npx nx build admin-panel

# ─── Stage 2: Runner ──────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Standalone server reads PORT and HOSTNAME at runtime
ENV PORT=4200
ENV HOSTNAME=0.0.0.0

# Copy the self-contained standalone server and its bundled node_modules
COPY --from=builder /app/dist/apps/admin-panel/.next/standalone/ ./

# Copy static build artifacts (CSS, JS chunks) next to the standalone server
COPY --from=builder /app/dist/apps/admin-panel/.next/static/ ./.next/static/

# Copy public assets
COPY --from=builder /app/dist/apps/admin-panel/public/ ./public/

EXPOSE 4200

CMD ["node", "server.js"]
