# Getting Started - Water Supply SaaS CRM

This guide will help you set up and run the Water Supply CRM project locally.

## Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Docker & Docker Compose](https://www.docker.com/)
- [NX CLI](https://nx.dev/getting-started/intro) (optional, but recommended: `npm install -g nx`)

## Project Structure

- `apps/admin-panel`: Next.js app for Super Admins.
- `apps/vendor-dashboard`: Next.js app for Water Business Owners.
- `apps/customer-portal`: Next.js app for end customers.
- `apps/api-backend`: NestJS central API.
- `libs/shared/*`: Shared libraries (UI, Types, Database, Data Access).

## Local Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Environment Variables

Copy the `.env.example` to `.env`:

```bash
cp .env.example .env
```

### 3. Start Infrastructure (Docker)

Start PostgreSQL, Redis, RabbitMQ, and the API Backend using Docker Compose:

```bash
docker-compose up -d
```

### 4. Database Setup

Once the database is running, sync your Prisma schema:

```bash
npx prisma db push --schema=libs/shared/database/prisma/schema.prisma
```

### 5. Running Applications

You can run the frontend applications locally on your host machine:

```bash
# Admin Panel
npx nx serve admin-panel

# Vendor Dashboard
npx nx serve vendor-dashboard

# Customer Portal
npx nx serve customer-portal
```

## Useful Endpoints

- **API Backend:** [http://localhost:3333](http://localhost:3333)
- **pgAdmin:** [http://localhost:5050](http://localhost:5050) (Login with `PGADMIN_EMAIL` in `.env`)
- **RabbitMQ Management:** [http://localhost:15672](http://localhost:15672) (Login with `RABBITMQ_USER` in `.env`)

## Shadcn UI

To add new UI components to the shared library:

```bash
npx shadcn-ui@latest add [component-name] -c libs/shared/ui/components.json
```
