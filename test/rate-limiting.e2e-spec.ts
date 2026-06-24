import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.test') });

// Override with low limits before the NestJS module compiles so ConfigService
// picks them up during ThrottlerModule.forRootAsync initialization.
process.env.AUTH_THROTTLE_LIMIT = '3';
process.env.AUTH_THROTTLE_TTL_MS = '5000';
process.env.THROTTLE_LIMIT = '5';
process.env.THROTTLE_TTL_MS = '5000';
process.env.AI_REQUESTS_PER_MINUTE = '2';

import request from 'supertest';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from '../src/app.module';
import { MailService } from '../src/mail/mail.service';
import { AiService } from '../src/ai/ai.service';
import { MockMailService } from './helpers/mock-mail.service';
import { truncateAll, flushRedis } from './helpers/db';

async function createRateLimitTestApp(): Promise<{
  app: INestApplication;
  mockMail: MockMailService;
}> {
  const mockMail = new MockMailService();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MailService)
    .useValue(mockMail)
    .overrideProvider(AiService)
    .useValue({
      chat: jest.fn().mockResolvedValue({ operations_applied: 0 }),
    })
    .compile();

  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('v1');
  app.useGlobalPipes(new ValidationPipe({ transform: true }));
  app.useWebSocketAdapter(new WsAdapter(app));
  await app.init();

  return { app, mockMail };
}

describe('Rate limiting (e2e)', () => {
  let app: INestApplication;
  let mockMail: MockMailService;

  beforeAll(async () => {
    ({ app, mockMail } = await createRateLimitTestApp());
  });

  afterEach(async () => {
    await truncateAll();
    await flushRedis();
    mockMail.clear();
  });

  afterAll(async () => {
    await app.close();
  });

  // --- Shared helpers ---

  async function signup(email: string, password = 'Password123!') {
    return request(app.getHttpServer())
      .post('/v1/auth/signup')
      .send({ email, firstName: 'Test', lastName: 'User', password });
  }

  async function createVerifiedUser(
    email: string,
    password = 'Password123!',
  ): Promise<string> {
    await signup(email, password);
    const token = mockMail.getVerificationToken(email)!;
    await request(app.getHttpServer())
      .post('/v1/auth/verify-email')
      .send({ email, token });
    const loginRes = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email, password });
    return loginRes.body.data.token as string;
  }

  async function createDocument(authToken: string, title = 'Test Doc') {
    const res = await request(app.getHttpServer())
      .post('/v1/documents')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ title });
    return res.body.data.id as string;
  }

  // --- Auth endpoint limits ---

  it('POST /auth/login returns 429 after AUTH_THROTTLE_LIMIT (3) attempts from same IP', async () => {
    for (let i = 0; i < 3; i++) {
      await request(app.getHttpServer())
        .post('/v1/auth/login')
        .send({ email: 'x@test.com', password: 'wrong' });
    }
    const res = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: 'x@test.com', password: 'wrong' });
    expect(res.status).toBe(429);
  });

  it('POST /auth/forgot-password returns 429 after 3 attempts from same IP', async () => {
    for (let i = 0; i < 3; i++) {
      await request(app.getHttpServer())
        .post('/v1/auth/forgot-password')
        .send({ email: 'x@test.com' });
    }
    const res = await request(app.getHttpServer())
      .post('/v1/auth/forgot-password')
      .send({ email: 'x@test.com' });
    expect(res.status).toBe(429);
  });

  // --- Retry-After header ---

  it('429 response includes a numeric Retry-After header', async () => {
    for (let i = 0; i < 3; i++) {
      await request(app.getHttpServer())
        .post('/v1/auth/login')
        .send({ email: 'x@test.com', password: 'wrong' });
    }
    const res = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: 'x@test.com', password: 'wrong' });
    expect(res.status).toBe(429);
    const retryAfter = Number(res.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(0);
  });

  // --- Per-user authenticated throttling ---

  it('two authenticated users from the same IP are throttled independently', async () => {
    // Create two users. Both requests come from the same supertest IP (127.0.0.1).
    const tokenA = await createVerifiedUser('user-a@test.com');
    const tokenB = await createVerifiedUser('user-b@test.com');

    // Exhaust user A's default throttle (THROTTLE_LIMIT = 5)
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer())
        .get('/v1/users')
        .set('Authorization', `Bearer ${tokenA}`);
    }
    const resA = await request(app.getHttpServer())
      .get('/v1/users')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(resA.status).toBe(429);

    // User B's counter is separate — should still get through
    const resB = await request(app.getHttpServer())
      .get('/v1/users')
      .set('Authorization', `Bearer ${tokenB}`);
    expect(resB.status).toBe(200);
  });

  // --- AI chat per-user-per-document ---

  it('POST /documents/:id/chat returns 429 after AI_REQUESTS_PER_MINUTE (2) per user per document', async () => {
    const token = await createVerifiedUser('ai-user@test.com');
    const docId = await createDocument(token);

    for (let i = 0; i < 2; i++) {
      const res = await request(app.getHttpServer())
        .post(`/v1/documents/${docId}/chat`)
        .set('Authorization', `Bearer ${token}`)
        .send({ message: 'hello' });
      expect(res.status).toBe(200);
    }

    const res = await request(app.getHttpServer())
      .post(`/v1/documents/${docId}/chat`)
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'hello' });
    expect(res.status).toBe(429);
  });

  it('AI chat throttle is per-document: hitting limit on one doc does not block another', async () => {
    const token = await createVerifiedUser('ai-doc-user@test.com');
    const docA = await createDocument(token, 'Doc A');
    const docB = await createDocument(token, 'Doc B');

    // Exhaust limit on docA
    for (let i = 0; i < 2; i++) {
      await request(app.getHttpServer())
        .post(`/v1/documents/${docA}/chat`)
        .set('Authorization', `Bearer ${token}`)
        .send({ message: 'hello' });
    }
    const throttledRes = await request(app.getHttpServer())
      .post(`/v1/documents/${docA}/chat`)
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'hello' });
    expect(throttledRes.status).toBe(429);

    // docB has its own counter and should still succeed
    const docBRes = await request(app.getHttpServer())
      .post(`/v1/documents/${docB}/chat`)
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'hello' });
    expect(docBRes.status).toBe(200);
  });

  // --- Health check exclusion ---

  it('GET /health is never rate limited even when other limits are exhausted', async () => {
    // Exhaust the auth throttle via login attempts
    for (let i = 0; i < 3; i++) {
      await request(app.getHttpServer())
        .post('/v1/auth/login')
        .send({ email: 'x@test.com', password: 'wrong' });
    }

    const healthRes = await request(app.getHttpServer()).get('/v1/health');
    expect(healthRes.status).toBe(200);
    expect(healthRes.body.status).toBe('ok');
  });
});
