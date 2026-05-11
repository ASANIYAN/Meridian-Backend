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
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      validationOptions: {
        abortEarly: false,
      },
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        throttlers: [
          {
            name: 'default',
            ttl: configService.getOrThrow<number>('THROTTLE_TTL_MS'),
            limit: configService.getOrThrow<number>('THROTTLE_LIMIT'),
          },
          {
            name: 'auth',
            ttl: configService.getOrThrow<number>('AUTH_THROTTLE_TTL_MS'),
            limit: configService.getOrThrow<number>('AUTH_THROTTLE_LIMIT'),
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
    RedisModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
