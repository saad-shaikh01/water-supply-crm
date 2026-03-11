# VPS Deployment

This repo is production-ready for a Docker-based VPS deployment with host Nginx in front.

## Stack Summary

- Frontend apps:
  - `admin-panel` on `127.0.0.1:4300`
  - `vendor-dashboard` on `127.0.0.1:4301`
  - `customer-portal` on `127.0.0.1:4302`
- Backend app:
  - `api-backend` on `127.0.0.1:3100`
- Internal infrastructure:
  - PostgreSQL (`postgres`)
  - Redis (`redis`) for caching, rate limiting, BullMQ jobs, and tracking Pub/Sub
- External/optional integrations:
  - Wasabi / S3-compatible object storage for screenshots and ticket attachments
  - SMTP for password reset mail
  - Firebase client config plus Firebase Admin SDK for push notifications
  - Paymob / Raast for hosted payment flows
  - WhatsApp Web automation

## Important Limitations

- `FRONTEND_URL` is a single backend env var. Password reset emails can target only one frontend base URL at a time.
- Queueing is Redis/BullMQ-based in the current codebase. RabbitMQ is not used by the production app services.
- The backend serves `/uploads`, but current screenshot/attachment flows use S3-compatible object storage. The `uploads_data` volume is retained for the local uploads directory and future compatibility.
- `NEXT_PUBLIC_*` values are baked into the frontend images at build time. If you change them, rebuild the affected frontend images.

## 1. VPS Requirements

- Ubuntu 22.04 or 24.04
- DNS records already pointed at the VPS:
  - `backend.testinglinq.com`
  - `admin.testinglinq.com`
  - `vendor.testinglinq.com`
  - `portal.testinglinq.com`
- Docker Engine + Compose plugin
- Nginx on the host machine
- Certbot with the Nginx plugin

Install host packages:

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg nginx certbot python3-certbot-nginx
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
newgrp docker
```

## 2. Prepare The Repo

```bash
git clone <your-repo-url> water-supply-crm
cd water-supply-crm
cp .env.prod.example .env.prod
```

Edit `.env.prod` and fill in:

- Required for every deploy:
  - `POSTGRES_USER`
  - `POSTGRES_PASSWORD`
  - `POSTGRES_DB`
  - `JWT_SECRET`
  - `NEXT_PUBLIC_API_URL`
- Optional, depending on enabled features:
  - `FRONTEND_URL`, `MAIL_*`
  - `WASABI_*`
  - `PAYMOB_*`, `API_URL`
  - `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN`
  - `NEXT_PUBLIC_FIREBASE_*`
  - `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`
  - `WHATSAPP_ENABLED`

## 3. Build And Start The Production Stack

First deploy:

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
```

Later updates:

```bash
git pull
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
```

Useful operational commands:

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml ps
docker compose --env-file .env.prod -f docker-compose.prod.yml logs -f api-backend
docker compose --env-file .env.prod -f docker-compose.prod.yml logs -f vendor-dashboard
docker compose --env-file .env.prod -f docker-compose.prod.yml pull
docker compose --env-file .env.prod -f docker-compose.prod.yml restart api-backend
```

To stop the stack:

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml down
```

## 4. Install Host Nginx Reverse Proxy

This project expects TLS termination on the host machine. Containers stay loopback-only on the VPS.

Install the sample config:

```bash
sudo cp deploy/nginx/water-supply-crm.conf /etc/nginx/sites-available/water-supply-crm.conf
sudo ln -s /etc/nginx/sites-available/water-supply-crm.conf /etc/nginx/sites-enabled/water-supply-crm.conf
sudo nano /etc/nginx/sites-available/water-supply-crm.conf
sudo nginx -t
sudo systemctl reload nginx
```

Before enabling it, replace:

- `backend.testinglinq.com`
- `admin.testinglinq.com`
- `vendor.testinglinq.com`
- `portal.testinglinq.com`

The sample config already includes the SSE-safe proxy block for:

- `GET /api/tracking/subscribe`

It disables proxy buffering and keeps the upgrade/long-read settings needed for live tracking streams.

## 5. Issue TLS Certificates

After DNS is live and port 80 is reachable:

```bash
sudo certbot --nginx \
  -d backend.testinglinq.com \
  -d admin.testinglinq.com \
  -d vendor.testinglinq.com \
  -d portal.testinglinq.com
```

Certbot will inject the HTTPS listeners and certificate paths into the Nginx config.

## 6. Health Checks

Docker health checks included in `docker-compose.prod.yml`:

- API: `http://127.0.0.1:3100/api/health/ready`
- Admin: `http://127.0.0.1:4300/auth/login`
- Vendor: `http://127.0.0.1:4301/auth/login`
- Portal: `http://127.0.0.1:4302/auth/login`

Manual host-side checks:

```bash
curl -fsS http://127.0.0.1:3100/api/health/live
curl -fsS http://127.0.0.1:3100/api/health/ready
curl -I http://127.0.0.1:4300/auth/login
curl -I http://127.0.0.1:4301/auth/login
curl -I http://127.0.0.1:4302/auth/login
```

Public smoke tests after TLS is live:

```bash
curl -fsS https://backend.testinglinq.com/api/health/ready
curl -I https://admin.testinglinq.com/auth/login
curl -I https://vendor.testinglinq.com/auth/login
curl -I https://portal.testinglinq.com/auth/login
```

Authenticated SSE smoke test for vendor tracking:

```bash
curl -N "https://backend.testinglinq.com/api/tracking/subscribe?token=<vendor-jwt>"
```

## 7. Persistent Data

Named Docker volumes used by the production stack:

- `postgres_data`
- `redis_data`
- `uploads_data`
- `whatsapp_session`

Inspect them:

```bash
docker volume ls | grep wscrm
docker volume inspect water-supply-crm_postgres_data
```

## 8. Deployment Notes

- `api-backend` runs `prisma migrate deploy` on container start.
- Internal services are not publicly exposed. Only loopback ports are published on the VPS.
- If you rotate `NEXT_PUBLIC_*` values, rebuild with:

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml build admin-panel vendor-dashboard customer-portal
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d
```
