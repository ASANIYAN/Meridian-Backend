import {
  describe,
  beforeEach,
  afterEach,
  it,
  expect,
  jest,
} from '@jest/globals';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import type { Server } from 'http';
import request from 'supertest';
import { HealthController } from './health.controller';
import { DATABASE_CONNECTION } from '../database/database-connection';
import { RedisService } from '../redis/redis.service';

describe('HealthController (unit)', () => {
  let app: INestApplication;
  let mockDbExecute: jest.Mock;
  let mockRedisPing: jest.Mock;

  beforeEach(async () => {
    mockDbExecute = jest.fn<() => Promise<unknown>>().mockResolvedValue([]);
    mockRedisPing = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: DATABASE_CONNECTION,
          useValue: { execute: mockDbExecute },
        },
        {
          provide: RedisService,
          useValue: { ping: mockRedisPing },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 200 with both checks up when DB and Redis are healthy', async () => {
    const res = await request(app.getHttpServer() as Server)
      .get('/health')
      .expect(200);
    expect(res.body).toEqual({
      status: 'ok',
      checks: { database: 'up', redis: 'up' },
    });
  });

  it('returns 503 with database down when the DB throws', async () => {
    mockDbExecute.mockRejectedValue(new Error('ECONNREFUSED'));
    const res = await request(app.getHttpServer() as Server)
      .get('/health')
      .expect(503);
    expect(res.body).toEqual({
      status: 'error',
      checks: { database: 'down', redis: 'up' },
    });
  });

  it('returns 503 with redis down when Redis ping throws', async () => {
    mockRedisPing.mockRejectedValue(new Error('Redis connection lost'));
    const res = await request(app.getHttpServer() as Server)
      .get('/health')
      .expect(503);
    expect(res.body).toEqual({
      status: 'error',
      checks: { database: 'up', redis: 'down' },
    });
  });

  it('returns 503 with both checks down when both dependencies throw', async () => {
    mockDbExecute.mockRejectedValue(new Error('DB down'));
    mockRedisPing.mockRejectedValue(new Error('Redis down'));
    const res = await request(app.getHttpServer() as Server)
      .get('/health')
      .expect(503);
    expect(res.body).toEqual({
      status: 'error',
      checks: { database: 'down', redis: 'down' },
    });
  });
});
