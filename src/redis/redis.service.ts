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
  private readonly subscriber: RedisClientType;

  constructor(private readonly configService: ConfigService) {
    const url = this.configService.getOrThrow<string>('REDIS_URL');

    this.client = createClient({ url });
    // A subscribed Redis connection can't issue other commands, so publishing and
    // blacklisting need a separate connection from subscribing.
    this.subscriber = this.client.duplicate();

    this.client.on('error', (error: Error) => {
      this.logger.error(`Redis client error: ${error.message}`);
    });

    this.subscriber.on('error', (error: Error) => {
      this.logger.error(`Redis subscriber error: ${error.message}`);
    });
  }

  async onModuleInit() {
    if (this.client.isOpen && this.subscriber.isOpen) {
      return;
    }

    await this.client.connect();
    await this.subscriber.connect();
    this.logger.log('Redis client and subscriber connected');
  }

  async onModuleDestroy() {
    if (this.client.isOpen) await this.client.quit();
    if (this.subscriber.isOpen) await this.subscriber.quit();
    this.logger.log('Redis clients disconnected');
  }

  async publish(channel: string, data: Buffer) {
    // Raw sendCommand instead of a typed publish helper, since payloads here are
    // binary (Yjs updates) and need to go out byte-for-byte.
    await this.client.sendCommand(['PUBLISH', channel, data]);
  }

  async subscribe(channel: string, callback: (data: Buffer) => void) {
    // The trailing `true` enables buffer mode, so callback receives a Buffer
    // instead of a decoded string.
    await this.subscriber.subscribe(channel, callback, true);
  }

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

  async isTokenBlacklisted(jti: string): Promise<boolean> {
    const value = await this.client.exists(this.getBlacklistKey(jti));
    return value === 1;
  }

  // SET ... NX is atomic, so concurrent callers can't both succeed for the same key
  // only the first caller gets `true` until the TTL expires.
  async tryAcquireLock(key: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.client.set(key, '1', {
      condition: 'NX',
      expiration: { type: 'EX', value: ttlSeconds },
    });
    return result === 'OK';
  }

  private getBlacklistKey(jti: string) {
    return `auth:blacklist:${jti}`;
  }
}
