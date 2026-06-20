import { Module } from '@nestjs/common';
import { SnapshotsService } from './snapshots.service';
import { SnapshotsController } from './snapshots.controller';
import { DatabaseModule } from '../database/database.module';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { SNAPSHOT_QUEUE } from './snapshot.queue';
import { YjsModule } from '../yjs/yjs.module';
import { OperationsModule } from '../operations/operations.module';
import { SnapshotProcessor } from './snapshot.processor';

@Module({
  imports: [
    DatabaseModule,
    YjsModule,
    OperationsModule,
    BullModule.registerQueue({ name: SNAPSHOT_QUEUE }),
  ],
  providers: [SnapshotsService, SnapshotProcessor],
  controllers: [SnapshotsController],
  exports: [SnapshotsService, getQueueToken(SNAPSHOT_QUEUE)],
})
export class SnapshotsModule {}
