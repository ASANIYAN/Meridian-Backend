# Meridian API

Backend service for Meridian, built with Node.js and NestJS.

## Requirements

- Node.js 20+
- npm
- Docker (for Postgres, Redis, pgAdmin)

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create your environment file:

```bash
cp .env.example .env
```

3. Update secrets in `.env` (at minimum: `DB_PASSWORD`, `REDIS_PASSWORD`, `JWT_SECRET`, `PGADMIN_DEFAULT_PASSWORD`).

## Run with Docker (local dependencies)

Start Postgres, Redis, and pgAdmin:

```bash
npm run compose:dev
```

Services:

- Postgres: `localhost:5432`
- Redis: `localhost:6379`
- pgAdmin: `http://localhost:5050`

Stop containers:

```bash
npm run compose:dev:down
```

## Run the API

Development:

```bash
npm run start:dev
```

Production build:

```bash
npm run build
npm run start:prod
```

## Tests

```bash
npm run test
npm run test:e2e
npm run test:cov
```
