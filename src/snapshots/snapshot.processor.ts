import * as Y from 'yjs';
import * as schema from '../database/schema';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { SNAPSHOT_JOB, SNAPSHOT_QUEUE } from './snapshot.queue';
import { Job, Queue } from 'bullmq';
import { Inject, Logger } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DATABASE_CONNECTION } from '../database/database-connection';
import { SnapshotsService } from './snapshots.service';
import { OperationsService } from '../operations/operations.service';
import { YjsService } from '../yjs/yjs.service';

// @Processor tells BullMQ to route jobs from the 'snapshot' queue to this class.
// WorkerHost wires process() as the handler — no extra registration needed.
@Processor(SNAPSHOT_QUEUE)
export class SnapshotProcessor extends WorkerHost {
  private readonly logger = new Logger(SnapshotProcessor.name);

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly database: NodePgDatabase<typeof schema>,
    @InjectQueue(SNAPSHOT_QUEUE) private readonly queue: Queue,
    private readonly snapshotsService: SnapshotsService,
    private readonly operationsService: OperationsService,
    private readonly yjsService: YjsService,
  ) {
    super();
  }

  // Registers the periodic fallback sweep on startup.
  // BullMQ deduplicates repeatable jobs by name + interval, so calling this on
  // every instance startup is safe — it won't create duplicate schedules.
  async onModuleInit() {
    await this.queue.add(
      SNAPSHOT_JOB,
      { documentId: 'ALL' },
      { repeat: { every: 5 * 60 * 1000 } },
    );
  }

  // Entry point for every job on the snapshot queue.
  // Errors are caught and logged instead of rethrown so BullMQ marks the job
  // complete rather than retrying it — a failed snapshot is non-critical and
  // retrying immediately could hammer the DB.
  async process(job: Job<{ documentId: string }>): Promise<void> {
    const { documentId } = job.data;

    try {
      if (documentId === 'ALL') {
        // Periodic sweep: fan out one per-document job for every document in the DB.
        // jobId deduplicates against any in-flight disconnect-triggered job for the
        // same document, so at most one snapshot job per document is ever queued.
        const docs = await this.database
          .select({ id: schema.documents.id })
          .from(schema.documents);
        await Promise.all(
          docs.map((doc) =>
            this.queue.add(
              SNAPSHOT_JOB,
              { documentId: doc.id },
              { jobId: `snapshot:${doc.id}` },
            ),
          ),
        );
        return;
      }

      // Load the last compacted state as the starting point.
      // afterSequence is the operation_sequence already baked into that snapshot,
      // so we only fetch operations that arrived after it.
      const snapshot =
        await this.snapshotsService.getLatestSnapshot(documentId);
      const afterSequence = snapshot?.operationSequence ?? 0;

      const operations =
        await this.operationsService.getOperationsSinceSequence(
          documentId,
          afterSequence,
        );

      if (operations.length === 0) {
        this.logger.debug(
          `No new operations for document ${documentId}, skipped`,
        );
        return;
      }

      // Rebuild the document in memory by replaying snapshot → delta operations
      // in order. This produces the same state a client would get from a full replay.
      const doc = new Y.Doc();

      if (snapshot) {
        // Restore the prior compacted state so we only process the delta, not all
        // operations from the beginning of time.
        this.yjsService.decodeUpdate(doc, snapshot.contentBlob);
      }

      for (const op of operations) {
        if (op.yjsUpdate) {
          this.yjsService.decodeUpdate(doc, op.yjsUpdate);
        }
      }

      // Encode the fully-replayed doc into a single binary blob and a version vector.
      // The blob replaces the entire operation history for future loads.
      const contentBlob = this.yjsService.encodeState(doc);
      const versionVector = this.yjsService.encodeStateVector(doc);
      // The last operation's sequence number becomes the new snapshot's high-water mark.
      const highestSequence =
        operations[operations.length - 1].operationSequence;

      await this.snapshotsService.createSnapshot(
        documentId,
        contentBlob,
        versionVector,
        highestSequence,
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Snapshot job failed for document ${documentId}: ${msg}`,
      );
    }
  }
}
