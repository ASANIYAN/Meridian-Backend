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

  constructor(private readonly configService: ConfigService) {
    const host = this.configService.getOrThrow<string>('REDIS_HOST');
    const port = this.configService.getOrThrow<number>('REDIS_PORT');
    const password = this.configService.getOrThrow<string>('REDIS_PASSWORD');
    const useTls = this.configService.getOrThrow<boolean>('REDIS_TLS');
    const socket = useTls ? { host, port, tls: true as const } : { host, port };

    this.client = createClient({
      socket,
      ...(password ? { password } : {}),
    });

    this.client.on('error', (error: Error) => {
      this.logger.error(`Redis client error: ${error.message}`);
    });
  }

  async onModuleInit() {
    if (this.client.isOpen) {
      return;
    }

    await this.client.connect();
    this.logger.log('Redis client connected');
  }

  async onModuleDestroy() {
    if (!this.client.isOpen) {
      return;
    }

    await this.client.quit();
    this.logger.log('Redis client disconnected');
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

  private getBlacklistKey(jti: string) {
    return `auth:blacklist:${jti}`;
  }
}
