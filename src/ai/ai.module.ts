import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { OperationsModule } from '../operations/operations.module';
import { YjsModule } from '../yjs/yjs.module';
import { DatabaseModule } from '../database/database.module';
import { AiService } from './ai.service';
import { SnapshotsService } from '../snapshots/snapshots.service';
import { OutboxService } from '../outbox/outbox.service';
import { OUTBOX_QUEUE } from '../outbox/outbox.queue';

// AiModule registers the outbox queue directly and declares SnapshotsService +
// OutboxService as local providers rather than importing SnapshotsModule /
// OutboxModule. Both of those modules export BullMQ queue tokens alongside their
// services, and NestJS cannot re-resolve those tokens when the modules are
// consumed through the DocumentsModule → AiModule import chain.
@Module({
  imports: [
    OperationsModule,
    YjsModule,
    DatabaseModule,
    BullModule.registerQueue({ name: OUTBOX_QUEUE }),
  ],
  providers: [AiService, SnapshotsService, OutboxService],
  exports: [AiService],
})
export class AiModule {}
