import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { ConfigModule } from '@nestjs/config';
import { UsersModule } from './users/users.module';
import { DocumentsModule } from './documents/documents.module';
import { MembershipsModule } from './memberships/memberships.module';
import { SnapshotsModule } from './snapshots/snapshots.module';
import { OperationsModule } from './operations/operations.module';
import { ShareLinksModule } from './share_links/share_links.module';
import { PasswordResetTokensModule } from './password_reset_tokens/password_reset_tokens.module';
import { OutboxModule } from './outbox/outbox.module';
import { AppController } from './app.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    UsersModule,
    DocumentsModule,
    MembershipsModule,
    SnapshotsModule,
    OperationsModule,
    ShareLinksModule,
    PasswordResetTokensModule,
    OutboxModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
