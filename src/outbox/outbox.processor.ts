import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { OUTBOX_JOB, OUTBOX_QUEUE } from './outbox.queue';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Queue } from 'bullmq';
import { OutboxService } from './outbox.service';
import { RedisService } from '../redis/redis.service';

// The `doc:` channel subscriber (CollaborationGateway) treats the first 16 bytes of
// every frame as an instance-id header: it skips frames whose header matches its own
// id (its own echoed broadcasts) and strips the header before relaying the rest. Outbox
// deliveries don't originate from a live gateway instance, so they carry a 16-byte zero
// header. A real instance id is a random UUID and can never be all-zero, so no instance
// mistakes an outbox frame for its own echo, and the subscriber still strips exactly 16
// bytes to recover the raw Yjs update. Without this header the subscriber would strip 16
// bytes of actual payload and relay a corrupted update.
const OUTBOX_FRAME_HEADER = Buffer.alloc(16);

@Processor(OUTBOX_QUEUE)
export class OutboxProcessor extends WorkerHost {
  private readonly logger = new Logger(OutboxProcessor.name);
  private readonly BASE_DELAY_MS = 1000;
  private readonly MAX_DELAY_MS = 300_000;
  private readonly maxAttempts: number;

  constructor(
    @InjectQueue(OUTBOX_QUEUE)
    private readonly outboxQueue: Queue,
    private readonly outboxService: OutboxService,
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
  ) {
    super();
    this.maxAttempts = this.configService.getOrThrow<number>(
      'OUTBOX_MAX_ATTEMPTS',
    );
  }

  async onModuleInit() {
    const pendingRows = await this.outboxService.getPendingRows();

    const jobs = pendingRows.map((row) => ({
      name: OUTBOX_JOB,
      data: { outboxId: row.id },
      opts: { jobId: row.id },
    }));

    await this.outboxQueue.addBulk(jobs);
  }

  async process(job: Job<{ outboxId: string }>): Promise<void> {
    const { outboxId } = job.data;
    const outboxRow = await this.outboxService.getOutboxById(outboxId);

    if (!outboxRow) {
      return;
    }

    try {
      if (outboxRow.attempts >= this.maxAttempts) {
        this.logger.error(
          `Outbox ${outboxRow.id} exceeded max attempts of ${this.maxAttempts}: moving to dead letter`,
        );
        await this.outboxService.deleteRow(outboxId);
        return;
      }

      const receivers = await this.redisService.publish(
        `doc:${outboxRow.documentId}`,
        Buffer.concat([OUTBOX_FRAME_HEADER, outboxRow.payload]),
      );
      this.logger.log(
        `Outbox delivered: ${JSON.stringify({
          outboxId,
          documentId: outboxRow.documentId,
          byteLength: outboxRow.payload.byteLength,
          subscribers: receivers,
        })}`,
      );

      await this.outboxService.deleteRow(outboxId);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Outbox job failed for document ${outboxRow.documentId}: ${msg}`,
      );

      const newAttempts = outboxRow.attempts + 1;
      await this.outboxService.updateAttempts(outboxRow.id, newAttempts);

      let delay = this.BASE_DELAY_MS * 2 ** newAttempts;
      delay = Math.min(delay, this.MAX_DELAY_MS);
      delay = delay * (0.5 + Math.random() * 0.5);
      this.logger.warn(
        `Retrying outbox ${outboxRow.id} in ${Math.round(delay)}ms (attempt ${newAttempts})`,
      );
      await this.outboxQueue.add(
        OUTBOX_JOB,
        { outboxId: outboxRow.id },
        { delay, jobId: outboxRow.id },
      );
    }
  }
}
