import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.test') });

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp } from './helpers/create-test-app';

describe('Health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health returns 200 with database and redis up', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body).toEqual({
      status: 'ok',
      checks: { database: 'up', redis: 'up' },
    });
  });

  it('GET /health does not require a JWT — no 401 without Authorization header', async () => {
    await request(app.getHttpServer()).get('/health').expect(200);
  });

  it('GET /health responds in under 500ms', async () => {
    const start = Date.now();
    await request(app.getHttpServer()).get('/health').expect(200);
    expect(Date.now() - start).toBeLessThan(500);
  });
});
