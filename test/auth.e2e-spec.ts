import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.test') });

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp } from './helpers/create-test-app';
import { MockMailService } from './helpers/mock-mail.service';
import { truncateAll, flushRedis } from './helpers/db';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let mockMail: MockMailService;

  beforeAll(async () => {
    ({ app, mockMail } = await createTestApp());
  });

  afterEach(async () => {
    await truncateAll();
    await flushRedis();
    mockMail.clear();
  });

  afterAll(async () => {
    await app.close();
  });

  async function signup(email = 'user@test.com', password = 'Password123!') {
    return request(app.getHttpServer())
      .post('/v1/auth/signup')
      .send({ email, firstName: 'Test', lastName: 'User', password });
  }

  async function verifyEmail(email: string) {
    const token = mockMail.getVerificationToken(email);
    if (!token) throw new Error(`No verification token captured for ${email}`);
    return request(app.getHttpServer())
      .post('/v1/auth/verify-email')
      .send({ email, token });
  }

  async function login(email: string, password: string) {
    return request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email, password });
  }

  // --- Signup ---

  it('POST /auth/signup returns 201 with user data, no sensitive fields', async () => {
    const res = await signup();
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user).toMatchObject({
      email: 'user@test.com',
      firstName: 'Test',
      lastName: 'User',
    });
    expect(res.body.data.user.passwordHash).toBeUndefined();
    expect(res.body.data.user.verificationTokenHash).toBeUndefined();
  });

  it('POST /auth/signup with duplicate email returns 409', async () => {
    await signup();
    const res = await signup();
    expect(res.status).toBe(409);
  });

  it('POST /auth/signup with invalid email returns 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/signup')
      .send({
        email: 'not-an-email',
        firstName: 'Test',
        lastName: 'User',
        password: 'Password123!',
      });
    expect(res.status).toBe(400);
  });

  // --- Email Verification ---

  it('POST /auth/verify-email succeeds with valid token', async () => {
    await signup();
    const res = await verifyEmail('user@test.com');
    expect(res.status).toBe(201);
    expect(res.body.data.user.verifiedAt).toBeTruthy();
    expect(res.body.data.alreadyVerified).toBe(false);
  });

  it('POST /auth/verify-email with wrong token returns 400', async () => {
    await signup();
    const res = await request(app.getHttpServer())
      .post('/v1/auth/verify-email')
      .send({ email: 'user@test.com', token: 'not-a-valid-token' });
    expect(res.status).toBe(400);
  });

  it('POST /auth/verify-email on already verified returns alreadyVerified: true', async () => {
    await signup();
    await verifyEmail('user@test.com');
    const res = await verifyEmail('user@test.com');
    expect(res.status).toBe(201);
    expect(res.body.data.alreadyVerified).toBe(true);
  });

  // --- Login ---

  it('POST /auth/login before verification returns 403', async () => {
    await signup();
    const res = await login('user@test.com', 'Password123!');
    expect(res.status).toBe(403);
  });

  it('POST /auth/login with wrong password returns 401', async () => {
    await signup();
    await verifyEmail('user@test.com');
    const res = await login('user@test.com', 'WrongPassword!');
    expect(res.status).toBe(401);
  });

  it('POST /auth/login returns JWT token after successful verification', async () => {
    await signup();
    await verifyEmail('user@test.com');
    const res = await login('user@test.com', 'Password123!');
    expect(res.status).toBe(201);
    expect(typeof res.body.data.token).toBe('string');
    expect(res.body.data.token.length).toBeGreaterThan(0);
  });

  // --- Logout ---

  it('POST /auth/logout blacklists token; same token returns 401 on next request', async () => {
    await signup();
    await verifyEmail('user@test.com');
    const { token } = (await login('user@test.com', 'Password123!')).body.data;

    await request(app.getHttpServer())
      .post('/v1/auth/logout')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    await request(app.getHttpServer())
      .get('/v1/documents')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  // --- Token Refresh ---

  it('POST /auth/refresh returns new token; old token is rejected', async () => {
    await signup();
    await verifyEmail('user@test.com');
    const oldToken = (await login('user@test.com', 'Password123!')).body.data
      .token;

    const refreshRes = await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .set('Authorization', `Bearer ${oldToken}`)
      .expect(201);

    const newToken = refreshRes.body.data.token as string;
    expect(newToken).toBeTruthy();
    expect(newToken).not.toBe(oldToken);

    await request(app.getHttpServer())
      .get('/v1/documents')
      .set('Authorization', `Bearer ${oldToken}`)
      .expect(401);

    await request(app.getHttpServer())
      .get('/v1/documents')
      .set('Authorization', `Bearer ${newToken}`)
      .expect(200);
  });

  // --- Password Reset ---

  it('full password reset: forgot → reset → login with new password succeeds', async () => {
    const email = 'user@test.com';
    const oldPass = 'Password123!';
    const newPass = 'NewPassword456!';

    await signup(email, oldPass);
    await verifyEmail(email);

    await request(app.getHttpServer())
      .post('/v1/auth/forgot-password')
      .send({ email })
      .expect(201);

    const resetToken = mockMail.getResetToken(email);
    expect(resetToken).toBeTruthy();

    await request(app.getHttpServer())
      .post('/v1/auth/reset-password')
      .send({ email, token: resetToken, newPassword: newPass })
      .expect(201);

    await login(email, oldPass).then((res) => expect(res.status).toBe(401));

    const loginRes = await login(email, newPass);
    expect(loginRes.status).toBe(201);
    expect(loginRes.body.data.token).toBeTruthy();
  });

  it('POST /auth/forgot-password for unverified account does not send reset email', async () => {
    await signup();
    await request(app.getHttpServer())
      .post('/v1/auth/forgot-password')
      .send({ email: 'user@test.com' })
      .expect(201);
    expect(mockMail.getResetToken('user@test.com')).toBeUndefined();
  });

  it('POST /auth/forgot-password for nonexistent email returns 200', async () => {
    await request(app.getHttpServer())
      .post('/v1/auth/forgot-password')
      .send({ email: 'ghost@test.com' })
      .expect(201);
  });

  it('unauthenticated request to protected route returns 401', async () => {
    await request(app.getHttpServer()).get('/v1/documents').expect(401);
  });
});
