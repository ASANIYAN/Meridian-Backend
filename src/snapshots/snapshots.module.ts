import { Module } from '@nestjs/common';
import { SnapshotsService } from './snapshots.service';
import { SnapshotsController } from './snapshots.controller';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule],
  providers: [SnapshotsService],
  controllers: [SnapshotsController],
  exports: [SnapshotsService],
})
export class SnapshotsModule {}
