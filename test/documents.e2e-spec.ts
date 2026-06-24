import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.test') });

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp } from './helpers/create-test-app';
import { MockMailService } from './helpers/mock-mail.service';
import { truncateAll } from './helpers/db';

describe('Documents (e2e)', () => {
  let app: INestApplication;
  let mockMail: MockMailService;

  beforeAll(async () => {
    ({ app, mockMail } = await createTestApp());
  });

  afterEach(async () => {
    await truncateAll();
    mockMail.clear();
  });

  afterAll(async () => {
    await app.close();
  });

  // --- Shared helpers ---

  async function createUser(
    email: string,
    password = 'Password123!',
  ): Promise<string> {
    await request(app.getHttpServer())
      .post('/v1/auth/signup')
      .send({ email, firstName: 'Test', lastName: 'User', password });

    const token = mockMail.getVerificationToken(email)!;
    await request(app.getHttpServer())
      .post('/v1/auth/verify-email')
      .send({ email, token });

    const loginRes = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email, password });

    return loginRes.body.data.token as string;
  }

  async function createDocument(authToken: string, title = 'Test Document') {
    return request(app.getHttpServer())
      .post('/v1/documents')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ title });
  }

  // --- Acceptance criterion: timing ---

  it('signup → login → create document completes in under 2 seconds', async () => {
    const start = Date.now();
    const authToken = await createUser('timing@test.com');
    await createDocument(authToken);
    expect(Date.now() - start).toBeLessThan(2000);
  });

  // --- Document CRUD ---

  it('POST /documents creates a document with draft status', async () => {
    const authToken = await createUser('author@test.com');
    const res = await createDocument(authToken);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      title: 'Test Document',
      status: 'draft',
    });
  });

  it('POST /documents without auth returns 401', async () => {
    await request(app.getHttpServer())
      .post('/v1/documents')
      .send({ title: 'No auth' })
      .expect(401);
  });

  it('GET /documents lists only the requesting user documents', async () => {
    const tokenA = await createUser('a@test.com');
    const tokenB = await createUser('b@test.com');

    await createDocument(tokenA, 'Doc A');
    await createDocument(tokenB, 'Doc B');

    const res = await request(app.getHttpServer())
      .get('/v1/documents')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toBe('Doc A');
  });

  it('GET /documents/:id returns document with author role', async () => {
    const authToken = await createUser('author@test.com');
    const docId = (await createDocument(authToken)).body.data.id as string;

    const res = await request(app.getHttpServer())
      .get(`/v1/documents/${docId}`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('author');
  });

  it('GET /documents/:id by non-member returns 403', async () => {
    const tokenA = await createUser('a@test.com');
    const tokenB = await createUser('b@test.com');
    const docId = (await createDocument(tokenA)).body.data.id as string;

    await request(app.getHttpServer())
      .get(`/v1/documents/${docId}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(403);
  });

  it('PATCH /documents/:id updates the title', async () => {
    const authToken = await createUser('author@test.com');
    const docId = (await createDocument(authToken)).body.data.id as string;

    const res = await request(app.getHttpServer())
      .patch(`/v1/documents/${docId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ title: 'Updated Title' });

    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe('Updated Title');
  });

  it('PATCH /documents/:id/status updates to active', async () => {
    const authToken = await createUser('author@test.com');
    const docId = (await createDocument(authToken)).body.data.id as string;

    const res = await request(app.getHttpServer())
      .patch(`/v1/documents/${docId}/status`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ status: 'active' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('active');
  });

  // --- Full invite flow ---

  it('author adds member; member can access document with assigned role', async () => {
    const authorToken = await createUser('author@test.com');
    const editorToken = await createUser('editor@test.com');
    const docId = (await createDocument(authorToken)).body.data.id as string;

    const addRes = await request(app.getHttpServer())
      .post(`/v1/documents/${docId}/members`)
      .set('Authorization', `Bearer ${authorToken}`)
      .send({ email: 'editor@test.com', role: 'editor' });

    expect(addRes.status).toBe(201);
    expect(addRes.body.data.role).toBe('editor');

    const getRes = await request(app.getHttpServer())
      .get(`/v1/documents/${docId}`)
      .set('Authorization', `Bearer ${editorToken}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.data.role).toBe('editor');
  });

  it('editor cannot delete a document (403)', async () => {
    const authorToken = await createUser('author@test.com');
    const editorToken = await createUser('editor@test.com');
    const docId = (await createDocument(authorToken)).body.data.id as string;

    await request(app.getHttpServer())
      .post(`/v1/documents/${docId}/members`)
      .set('Authorization', `Bearer ${authorToken}`)
      .send({ email: 'editor@test.com', role: 'editor' });

    await request(app.getHttpServer())
      .delete(`/v1/documents/${docId}`)
      .set('Authorization', `Bearer ${editorToken}`)
      .expect(403);
  });

  it('viewer cannot add members (403)', async () => {
    const authorToken = await createUser('author@test.com');
    const viewerToken = await createUser('viewer@test.com');
    await createUser('target@test.com');
    const docId = (await createDocument(authorToken)).body.data.id as string;

    await request(app.getHttpServer())
      .post(`/v1/documents/${docId}/members`)
      .set('Authorization', `Bearer ${authorToken}`)
      .send({ email: 'viewer@test.com', role: 'viewer' });

    await request(app.getHttpServer())
      .post(`/v1/documents/${docId}/members`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ email: 'target@test.com', role: 'editor' })
      .expect(403);
  });

  it('author removes a member; removed member loses document access', async () => {
    const authorToken = await createUser('author@test.com');
    const editorToken = await createUser('editor@test.com');
    const docId = (await createDocument(authorToken)).body.data.id as string;

    const addRes = await request(app.getHttpServer())
      .post(`/v1/documents/${docId}/members`)
      .set('Authorization', `Bearer ${authorToken}`)
      .send({ email: 'editor@test.com', role: 'editor' });

    const memberId = addRes.body.data.id as string;

    await request(app.getHttpServer())
      .delete(`/v1/documents/${docId}/members/${memberId}`)
      .set('Authorization', `Bearer ${authorToken}`)
      .expect(204);

    await request(app.getHttpServer())
      .get(`/v1/documents/${docId}`)
      .set('Authorization', `Bearer ${editorToken}`)
      .expect(403);
  });

  // --- Share link flow ---

  it('author creates share link; another user claims it and gains access', async () => {
    const authorToken = await createUser('author@test.com');
    const claimerToken = await createUser('claimer@test.com');
    const docId = (await createDocument(authorToken)).body.data.id as string;

    const linkRes = await request(app.getHttpServer())
      .post(`/v1/documents/${docId}/links`)
      .set('Authorization', `Bearer ${authorToken}`)
      .send({ role: 'viewer', isSingleUse: false });

    expect(linkRes.status).toBe(201);
    const linkToken = linkRes.body.data.token as string;

    const claimRes = await request(app.getHttpServer())
      .post(`/v1/documents/${docId}/links/validate?token=${linkToken}`)
      .set('Authorization', `Bearer ${claimerToken}`)
      .expect(200);

    expect(claimRes.body.data.membership.role).toBe('viewer');

    await request(app.getHttpServer())
      .get(`/v1/documents/${docId}`)
      .set('Authorization', `Bearer ${claimerToken}`)
      .expect(200);
  });

  it('single-use share link cannot be claimed a second time', async () => {
    const authorToken = await createUser('author@test.com');
    const claimerA = await createUser('claimer-a@test.com');
    const claimerB = await createUser('claimer-b@test.com');
    const docId = (await createDocument(authorToken)).body.data.id as string;

    const linkRes = await request(app.getHttpServer())
      .post(`/v1/documents/${docId}/links`)
      .set('Authorization', `Bearer ${authorToken}`)
      .send({ role: 'editor', isSingleUse: true });

    const linkToken = linkRes.body.data.token as string;

    await request(app.getHttpServer())
      .post(`/v1/documents/${docId}/links/validate?token=${linkToken}`)
      .set('Authorization', `Bearer ${claimerA}`)
      .expect(200);

    await request(app.getHttpServer())
      .post(`/v1/documents/${docId}/links/validate?token=${linkToken}`)
      .set('Authorization', `Bearer ${claimerB}`)
      .expect(403);
  });

  it('author revokes share link; subsequent claim attempt returns 403', async () => {
    const authorToken = await createUser('author@test.com');
    const claimerToken = await createUser('claimer@test.com');
    const docId = (await createDocument(authorToken)).body.data.id as string;

    const linkRes = await request(app.getHttpServer())
      .post(`/v1/documents/${docId}/links`)
      .set('Authorization', `Bearer ${authorToken}`)
      .send({ role: 'viewer', isSingleUse: false });

    const linkToken = linkRes.body.data.token as string;

    await request(app.getHttpServer())
      .patch(`/v1/documents/${docId}/links/${linkToken}`)
      .set('Authorization', `Bearer ${authorToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .post(`/v1/documents/${docId}/links/validate?token=${linkToken}`)
      .set('Authorization', `Bearer ${claimerToken}`)
      .expect(403);
  });

  // --- Soft delete ---

  it('DELETE /documents/:id soft-deletes; document excluded from list and returns 404 on direct fetch', async () => {
    const authToken = await createUser('author@test.com');
    const docId = (await createDocument(authToken)).body.data.id as string;

    await request(app.getHttpServer())
      .delete(`/v1/documents/${docId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(204);

    const listRes = await request(app.getHttpServer())
      .get('/v1/documents')
      .set('Authorization', `Bearer ${authToken}`);

    expect(listRes.body.data).toHaveLength(0);

    await request(app.getHttpServer())
      .get(`/v1/documents/${docId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(404);
  });

  it('DELETE /documents/:id on already-deleted document returns 404', async () => {
    const authToken = await createUser('author@test.com');
    const docId = (await createDocument(authToken)).body.data.id as string;

    await request(app.getHttpServer())
      .delete(`/v1/documents/${docId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(204);

    await request(app.getHttpServer())
      .delete(`/v1/documents/${docId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(404);
  });
});
