import { Module } from '@nestjs/common';
import { CollaborationGateway } from './collaboration.gateway';
import { ConfigModule } from '@nestjs/config';
import { RedisModule } from '../redis/redis.module';
import { MembershipsModule } from '../memberships/memberships.module';
import { SnapshotsModule } from '../snapshots/snapshots.module';
import { OperationsModule } from '../operations/operations.module';
import { OutboxModule } from '../outbox/outbox.module';
import { DatabaseModule } from '../database/database.module';
import { YjsModule } from '../yjs/yjs.module';

@Module({
  imports: [
    ConfigModule,
    RedisModule,
    MembershipsModule,
    SnapshotsModule,
    OperationsModule,
    OutboxModule,
    DatabaseModule,
    YjsModule,
  ],
  providers: [CollaborationGateway],
  controllers: [],
  exports: [CollaborationGateway],
})
export class CollaborationModule {}
