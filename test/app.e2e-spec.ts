import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.test') });

import request from 'supertest';
import { createTestApp } from './helpers/create-test-app';
import { INestApplication } from '@nestjs/common';

describe('App (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /v1 returns service status', async () => {
    const res = await request(app.getHttpServer()).get('/v1').expect(200);
    expect(res.body).toMatchObject({
      status: 'ok',
      service: 'Meridian-Backend',
    });
  });
});
