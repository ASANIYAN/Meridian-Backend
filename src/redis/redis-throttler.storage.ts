import { Injectable } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { RedisService } from './redis.service';

type ThrottlerStorageRecord = Awaited<
  ReturnType<ThrottlerStorage['increment']>
>;

@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly redisService: RedisService) {}

  async increment(
    key: string,
    ttl: number,
    _limit: number,
    _blockDuration: number,
    _throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const [totalHits, remainingTtlMs] =
      await this.redisService.throttleIncrement(key, ttl);

    return {
      totalHits,
      timeToExpire: Math.max(0, remainingTtlMs),
      isBlocked: false,
      timeToBlockExpire: 0,
    };
  }
}
