import { Module } from '@nestjs/common';
import { CollaborationGateway } from './collaboration.gateway';
import { ConfigModule } from '@nestjs/config';
import { RedisModule } from '../redis/redis.module';
import { MembershipsModule } from '../memberships/memberships.module';
import { SnapshotsModule } from '../snapshots/snapshots.module';
import { OperationsModule } from '../operations/operations.module';

@Module({
  imports: [
    ConfigModule,
    RedisModule,
    MembershipsModule,
    SnapshotsModule,
    OperationsModule,
  ],
  providers: [CollaborationGateway],
  controllers: [],
  exports: [CollaborationGateway],
})
export class CollaborationModule {}
