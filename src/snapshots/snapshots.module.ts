import { Module } from '@nestjs/common';
import { SnapshotsService } from './snapshots.service';
import { DatabaseModule } from '../database/database.module';
import { BullModule } from '@nestjs/bullmq';
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
  exports: [SnapshotsService],
})
export class SnapshotsModule {}
