import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { ConfigModule } from '@nestjs/config';
import { envValidationSchema } from './config/env.validation';
import { UsersModule } from './users/users.module';
import { DocumentsModule } from './documents/documents.module';
import { MembershipsModule } from './memberships/memberships.module';
import { SnapshotsModule } from './snapshots/snapshots.module';
import { OperationsModule } from './operations/operations.module';
import { ShareLinksModule } from './share_links/share_links.module';
import { PasswordResetTokensModule } from './password_reset_tokens/password_reset_tokens.module';
import { OutboxModule } from './outbox/outbox.module';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { MailModule } from './mail/mail.module';
import { RedisModule } from './redis/redis.module';
import { RedisThrottlerStorage } from './redis/redis-throttler.storage';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { CollaborationModule } from './collaboration/collaboration.module';
import { HttpOnlyThrottlerGuard } from './common/guards/http-only-throttler.guard';
import { HealthModule } from './health/health.module';
import { BullModule } from '@nestjs/bullmq';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      validationOptions: {
        abortEarly: false,
      },
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: { url: config.getOrThrow('REDIS_URL') },
      }),
    }),
    RedisModule,
    ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [ConfigService, RedisThrottlerStorage],
      useFactory: (config: ConfigService, storage: RedisThrottlerStorage) => ({
        storage,
        throttlers: [
          {
            name: 'default',
            ttl: config.getOrThrow<number>('THROTTLE_TTL_MS'),
            limit: config.getOrThrow<number>('THROTTLE_LIMIT'),
          },
          {
            name: 'auth',
            ttl: config.getOrThrow<number>('AUTH_THROTTLE_TTL_MS'),
            limit: config.getOrThrow<number>('AUTH_THROTTLE_LIMIT'),
          },
          {
            name: 'ai-chat',
            ttl: 60_000,
            limit: config.getOrThrow<number>('AI_REQUESTS_PER_MINUTE'),
          },
        ],
      }),
    }),
    DatabaseModule,
    UsersModule,
    DocumentsModule,
    MembershipsModule,
    SnapshotsModule,
    OperationsModule,
    ShareLinksModule,
    PasswordResetTokensModule,
    OutboxModule,
    AuthModule,
    MailModule,
    CollaborationModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: HttpOnlyThrottlerGuard,
    },
  ],
})
export class AppModule {}
