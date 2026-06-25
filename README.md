# Meridian

Real-time collaborative document editing API with Yjs CRDT sync, AI-assisted editing, and role-based access control.

## Description

Meridian is a NestJS backend for collaborative document editing. Multiple users can edit a document simultaneously — changes are synchronized over WebSocket using Yjs CRDT updates and broadcast across server instances via Redis pub/sub. Documents track a full operation log with Lamport clocks, periodically compacted into snapshots. An AI editing endpoint accepts natural-language instructions and applies them as Yjs operations via Gemini.

## Tech Stack

| Category       | Library / Version                                   |
| -------------- | --------------------------------------------------- |
| Framework      | NestJS 11, TypeScript 5.7                           |
| Database       | PostgreSQL 16 · Drizzle ORM 0.45 · drizzle-kit 0.31 |
| Cache / Queue  | Redis 5.12 · BullMQ 5.79                            |
| Real-time sync | Yjs 13.6 · `@nestjs/platform-ws` 11                 |
| Auth           | Passport-JWT 4 · `@nestjs/jwt` 11                   |
| AI             | `@google/generative-ai` 0.24 (Gemini 2.5 Flash)     |
| Email          | `@nestjs-modules/mailer` 2.3 (SMTP)                 |
| Rate limiting  | `@nestjs/throttler` 6 backed by Redis               |
| API docs       | Swagger / OpenAPI (`@nestjs/swagger` 11)            |
| Testing        | Jest 30 · Supertest 7                               |

## Architecture

- **HTTP API** (configurable `PORT`) and **WebSocket gateway** (`WS_PORT`, default 8001) run as separate listeners in the same process.
- The WebSocket gateway authenticates connections via JWT, routes Yjs binary updates into an operation log (Postgres), and fan-outs to room peers. Redis pub/sub bridges updates across multiple server instances.
- An **outbox pattern** (BullMQ + Postgres) ensures operations are reliably delivered even if a worker crashes mid-write.
- **Snapshots** compact accumulated operations into a single Yjs state blob on disconnect (threshold-based) or on a scheduled interval, keeping replay time bounded.
- All routes return a consistent `{ success, message, data, meta? }` envelope; errors go through a global exception filter.

## Prerequisites

- Node.js ≥ 20
- npm
- Docker (for Postgres + Redis)
- A [Google Gemini API key](https://aistudio.google.com/app/apikey) (for the AI chat endpoint)
- SMTP credentials (for email verification and password reset)

## Local Setup

1. **Clone and install**

```bash
git clone <repo-url>
cd meridian
npm install
```

2. **Configure environment**

```bash
cp .env.example .env
```

Required variables to fill in:

```
# App
PORT=                        # HTTP listen port
WS_PORT=8001                 # WebSocket gateway port
APP_URL=                     # Frontend origin (for CORS / email links)

# Database
POSTGRES_PASSWORD=
DB_URL=postgresql://meridian:<password>@localhost:5432/meridian

# Redis
REDIS_PASSWORD=
REDIS_URL=redis://:<password>@localhost:6379

# JWT
JWT_SECRET=
JWT_ALGORITHM=HS256
JWT_EXPIRY=15m
JWT_REFRESH_EXPIRY=30d
EMAIL_VERIFICATION_TOKEN_EXPIRY_HOURS=24

# Password Reset
PASSWORD_RESET_TOKEN_EXPIRY_HOURS=1
PASSWORD_RESET_MAX_ATTEMPTS=3

# Email (SMTP)
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=

# Gemini
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
```

See `.env.example` for the full list of optional tuning variables (rate limits, snapshot thresholds, share-link TTL, etc.).

3. **Start infrastructure**

```bash
docker compose up -d
```

Starts Postgres 16 on `:5432` and Redis on `:6379`.

4. **Run migrations**

```bash
npm run drizzle:push
```

5. **Start the server**

```bash
npm run start:dev
```

Swagger UI is available at `http://localhost:<PORT>/docs`.

## Key API Endpoints

All HTTP routes are prefixed with `/v1` except `/health`.

| Method   | Path                                | Auth   | Description                                    |
| -------- | ----------------------------------- | ------ | ---------------------------------------------- |
| `POST`   | `/v1/auth/signup`                   | —      | Register; queues verification email            |
| `POST`   | `/v1/auth/login`                    | —      | Authenticate; returns JWT                      |
| `POST`   | `/v1/auth/logout`                   | Bearer | Blacklist current token                        |
| `POST`   | `/v1/auth/refresh`                  | Bearer | Rotate JWT; blacklist old token                |
| `POST`   | `/v1/auth/forgot-password`          | —      | Send password reset email                      |
| `POST`   | `/v1/auth/reset-password`           | —      | Consume reset token; update password           |
| `GET`    | `/v1/documents`                     | Bearer | List documents the user is a member of         |
| `POST`   | `/v1/documents`                     | Bearer | Create document (creator becomes author)       |
| `GET`    | `/v1/documents/:id`                 | Bearer | Get document metadata + member count           |
| `PATCH`  | `/v1/documents/:id`                 | Bearer | Update document title (author/editor)          |
| `DELETE` | `/v1/documents/:id`                 | Bearer | Soft-delete document (author only)             |
| `GET`    | `/v1/documents/:id/members`         | Bearer | List members and their roles                   |
| `POST`   | `/v1/documents/:id/members`         | Bearer | Add member by email (author only)              |
| `PATCH`  | `/v1/documents/:id/members/:userId` | Bearer | Change member role (author only)               |
| `DELETE` | `/v1/documents/:id/members/:userId` | Bearer | Remove member (author only)                    |
| `POST`   | `/v1/documents/:id/links`           | Bearer | Generate share link (author only)              |
| `PATCH`  | `/v1/documents/:id/links/:token`    | Bearer | Revoke share link (author only)                |
| `POST`   | `/v1/documents/:id/links/validate`  | Bearer | Claim share link; join document                |
| `POST`   | `/v1/documents/:id/chat`            | Bearer | Apply AI instruction to document (author only) |
| `GET`    | `/health`                           | —      | Liveness + DB/Redis readiness check            |

**WebSocket** — connect to `ws://host:<WS_PORT>` with `Authorization: Bearer <token>` header (or `?token=` query param), then send:

| Event                | Direction       | Payload                                          |
| -------------------- | --------------- | ------------------------------------------------ |
| `join`               | client → server | `{ document_id: string }`                        |
| `initial_state`      | server → client | `{ snapshot: base64\|null, delta: Operation[] }` |
| `update`             | client → server | Yjs binary update (Buffer)                       |
| `ack`                | server → client | `{ operation_sequence, status }`                 |
| `rate_limit_warning` | server → client | `{ message }`                                    |

## Running Tests

```bash
# Unit tests (src/**/*.spec.ts)
npm test

# E2E tests against a live DB and Redis (test/*.e2e-spec.ts)
npm run test:e2e

# Unit tests with coverage report
npm run test:cov
```

E2E tests require `.env.test` to be configured and a running Postgres + Redis instance.

## Project Structure

```
src/
├── auth/            JWT auth, guards, strategies, password-reset flow
├── users/           User records
├── documents/       Document CRUD, role guards, AI chat endpoint
├── memberships/     Document role management (author / editor / viewer)
├── operations/      Operation log with Lamport clock
├── snapshots/       Yjs state snapshot creation and retrieval
├── outbox/          Reliable delivery pattern via BullMQ
├── collaboration/   WebSocket gateway — Yjs sync, presence, rate limiting
├── ai/              Gemini integration for natural-language document edits
├── share_links/     Invitation link generation and claiming
├── redis/           Redis client, pub/sub, JWT blacklist, throttler storage
├── mail/            SMTP email via BullMQ queue
├── health/          Health check endpoint (DB + Redis probes)
├── common/          Shared filters, guards, DTOs, Swagger utilities
└── config/          Env validation schema (Joi)
drizzle/             SQL migration files
test/                E2E test suites and helpers
```
