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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      validationOptions: {
        abortEarly: false,
      },
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
})
export class AppModule {}
