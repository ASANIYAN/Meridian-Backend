import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RedisService } from './redis.service';

// The presence helpers are thin wrappers over redis hash commands, so the tests assert
// the exact commands/keys issued and the values returned — the real client is replaced
// with a mock so no Redis connection is needed.
describe('RedisService presence', () => {
  let service: RedisService;
  // Typed so mockResolvedValue accepts the real return shapes instead of `never`.
  let client: {
    hIncrBy: jest.Mock<
      (key: string, field: string, incr: number) => Promise<number>
    >;
    hSet: jest.Mock<
      (key: string, field: string, value: string) => Promise<number>
    >;
    expire: jest.Mock<(key: string, seconds: number) => Promise<boolean>>;
    eval: jest.Mock<(script: string, options: unknown) => Promise<unknown>>;
    hGetAll: jest.Mock<(key: string) => Promise<Record<string, string>>>;
  };

  const countKey = 'presence:doc:doc-1:count';
  const idKey = 'presence:doc:doc-1:identity';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisService,
        {
          provide: ConfigService,
          useValue: { getOrThrow: () => 'redis://localhost:6379' },
        },
      ],
    }).compile();

    service = module.get<RedisService>(RedisService);

    client = {
      hIncrBy:
        jest.fn<
          (key: string, field: string, incr: number) => Promise<number>
        >(),
      hSet: jest.fn<
        (key: string, field: string, value: string) => Promise<number>
      >(),
      expire: jest.fn<(key: string, seconds: number) => Promise<boolean>>(),
      eval: jest.fn<(script: string, options: unknown) => Promise<unknown>>(),
      hGetAll: jest.fn<(key: string) => Promise<Record<string, string>>>(),
    };
    // Replace the connection built in the constructor with the mock.
    (service as unknown as { client: typeof client }).client = client;
  });

  describe('presenceJoin', () => {
    it('returns 1 for a user first connection and refreshes both key TTLs', async () => {
      client.hIncrBy.mockResolvedValue(1);
      client.expire.mockResolvedValue(true);

      const result = await service.presenceJoin('doc-1', 'user-1');

      expect(result).toBe(1);
      expect(client.hIncrBy).toHaveBeenCalledWith(countKey, 'user-1', 1);
      expect(client.expire).toHaveBeenCalledWith(countKey, expect.any(Number));
      expect(client.expire).toHaveBeenCalledWith(idKey, expect.any(Number));
    });

    it('returns the higher count for an additional connection (e.g. a second tab)', async () => {
      client.hIncrBy.mockResolvedValue(2);
      client.expire.mockResolvedValue(true);

      const result = await service.presenceJoin('doc-1', 'user-1');

      expect(result).toBe(2);
    });
  });

  describe('setPresenceIdentity', () => {
    it('stores the display name on the identity hash and refreshes its TTL', async () => {
      client.hSet.mockResolvedValue(1);
      client.expire.mockResolvedValue(true);

      await service.setPresenceIdentity('doc-1', 'user-1', 'Jane Doe');

      expect(client.hSet).toHaveBeenCalledWith(idKey, 'user-1', 'Jane Doe');
      expect(client.expire).toHaveBeenCalledWith(idKey, expect.any(Number));
    });
  });

  describe('presenceLeave', () => {
    it('returns remaining count and no name while other connections survive', async () => {
      client.eval.mockResolvedValue([1, false]);

      const result = await service.presenceLeave('doc-1', 'user-1');

      expect(result).toEqual({ remaining: 1, name: null });
      expect(client.eval).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          keys: [countKey, idKey],
          arguments: ['user-1'],
        }),
      );
    });

    it('returns remaining 0 and the announced name when the last connection closes', async () => {
      client.eval.mockResolvedValue([0, 'Jane Doe']);

      const result = await service.presenceLeave('doc-1', 'user-1');

      expect(result).toEqual({ remaining: 0, name: 'Jane Doe' });
    });
  });

  describe('presenceRoster', () => {
    it('returns the identity hash as the { userId: name } roster', async () => {
      client.hGetAll.mockResolvedValue({
        'user-1': 'Jane Doe',
        'user-2': 'Al',
      });

      const result = await service.presenceRoster('doc-1');

      expect(result).toEqual({ 'user-1': 'Jane Doe', 'user-2': 'Al' });
      expect(client.hGetAll).toHaveBeenCalledWith(idKey);
    });
  });
});
