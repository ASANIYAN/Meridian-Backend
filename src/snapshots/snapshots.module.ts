import { Module } from '@nestjs/common';
import { SnapshotsService } from './snapshots.service';
import { SnapshotsController } from './snapshots.controller';

@Module({
  providers: [SnapshotsService],
  controllers: [SnapshotsController]
})
export class SnapshotsModule {}
