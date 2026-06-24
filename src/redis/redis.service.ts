import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, type RedisClientType } from 'redis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: RedisClientType;
  // A subscribed Redis connection can't issue other commands, so publishing and
  // blacklisting need a separate connection from subscribing.
  private readonly subscriber: RedisClientType;

  private readonly host: string;

  constructor(private readonly configService: ConfigService) {
    const url = this.configService.getOrThrow<string>('REDIS_URL');
    this.host = new URL(url).host;

    this.client = createClient({
      url,
      socket: {
        // Exponential backoff capped at 30 s; retries indefinitely.
        reconnectStrategy: (retries) => Math.min(retries * 100, 30_000),
      },
    });
    // duplicate() creates a second connection sharing the same config, avoiding
    // the need to call createClient() again with the same URL.
    this.subscriber = this.client.duplicate();

    this.client.on('error', (error: Error) => {
      this.logger.error(
        `Redis client error (host: ${this.host}): ${error.message}`,
      );
    });

    this.subscriber.on('error', (error: Error) => {
      this.logger.error(
        `Redis subscriber error (host: ${this.host}): ${error.message}`,
      );
    });
  }

  // Opens both connections and verifies reachability with PING when the module starts.
  async onModuleInit() {
    if (this.client.isOpen && this.subscriber.isOpen) {
      return;
    }

    await this.client.connect();
    await this.subscriber.connect();
    await this.client.ping();
    this.logger.log(
      `Redis client and subscriber connected (host: ${this.host})`,
    );
  }

  // Gracefully closes both connections on app shutdown so in-flight commands finish.
  async onModuleDestroy() {
    if (this.client.isOpen) await this.client.quit();
    if (this.subscriber.isOpen) await this.subscriber.quit();
    this.logger.log('Redis clients disconnected');
  }

  // Publishes a binary payload to a Redis pub/sub channel (e.g. a Yjs update frame).
  // Uses raw sendCommand because the typed publish helper encodes data as a string,
  // which corrupts binary payloads.
  async publish(channel: string, data: Buffer) {
    await this.client.sendCommand(['PUBLISH', channel, data]);
  }

  // Registers a callback that fires whenever a message arrives on the channel.
  // The `true` flag enables buffer mode so the callback receives raw bytes, not a string.
  async subscribe(channel: string, callback: (data: Buffer) => void) {
    await this.subscriber.subscribe(channel, callback, true);
  }

  async unsubscribe(channel: string) {
    await this.subscriber.unsubscribe(channel);
  }

  async ping(): Promise<void> {
    await this.client.ping();
  }

  // Adds a JWT ID to the revocation list with an expiry matching the token's remaining TTL.
  // Skipped if ttlSeconds <= 0 — the token is already expired, no need to store it.
  async blacklistToken(jti: string, ttlSeconds: number) {
    if (ttlSeconds <= 0) {
      return;
    }

    await this.client.set(this.getBlacklistKey(jti), '1', {
      expiration: {
        type: 'EX',
        value: ttlSeconds,
      },
    });
  }

  // Returns true if the JWT ID is on the revocation list.
  async isTokenBlacklisted(jti: string): Promise<boolean> {
    const value = await this.client.exists(this.getBlacklistKey(jti));
    return value === 1;
  }

  // Tries to acquire an exclusive lock by setting a key only if it doesn't exist (NX).
  // Returns true if this caller got the lock, false if someone else already holds it.
  // The key auto-expires after ttlSeconds so stale locks don't block forever.
  async tryAcquireLock(key: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.client.set(key, '1', {
      condition: 'NX',
      expiration: { type: 'EX', value: ttlSeconds },
    });
    return result === 'OK';
  }

  // Atomically increments a counter key, setting a TTL (ms) on the first hit.
  // Returns [hitCount, remainingTtlMs] from a Lua script so both ops are atomic.
  async throttleIncrement(
    key: string,
    ttlMs: number,
  ): Promise<[number, number]> {
    const script = `
      local c = redis.call('INCR', KEYS[1])
      if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
      return {c, redis.call('PTTL', KEYS[1])}
    `;
    const raw = await this.client.eval(script, {
      keys: [key],
      arguments: [String(ttlMs)],
    });
    const result = raw as unknown as [number, number];
    return [Number(result[0]), Number(result[1])];
  }

  private getBlacklistKey(jti: string) {
    return `auth:blacklist:${jti}`;
  }
}
