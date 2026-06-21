import * as schema from '../database/schema';
import { Inject, Injectable } from '@nestjs/common';
import { DATABASE_CONNECTION } from '../database/database-connection';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { ConfigService } from '@nestjs/config';
import { asc, eq, lt } from 'drizzle-orm';
import { InjectQueue } from '@nestjs/bullmq';
import { OUTBOX_JOB, OUTBOX_QUEUE } from './outbox.queue';
import { Queue } from 'bullmq';

@Injectable()
export class OutboxService {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly database: NodePgDatabase<typeof schema>,
    @InjectQueue(OUTBOX_QUEUE)
    private readonly outboxQueue: Queue,
    private readonly configService: ConfigService,
  ) {}

  async insertOutboxEntry(
    db: NodePgDatabase<typeof schema>,
    data: { documentId: string; operationId: string; payload: Buffer },
  ) {
    const [entry] = await db
      .insert(schema.outbox)
      .values({
        documentId: data.documentId,
        operationId: data.operationId,
        payload: data.payload,
      })
      .returning();

    return entry.id;
  }

  async getPendingRows() {
    const maxAttempts = this.configService.getOrThrow<number>(
      'OUTBOX_MAX_ATTEMPTS',
    );

    const pendingRows = await this.database
      .select()
      .from(schema.outbox)
      .where(lt(schema.outbox.attempts, maxAttempts))
      .orderBy(asc(schema.outbox.createdAt));

    return pendingRows;
  }

  async getOutboxById(id: string) {
    const [matchedOutbox] = await this.database
      .select()
      .from(schema.outbox)
      .where(eq(schema.outbox.id, id));

    return matchedOutbox;
  }

  async deleteRow(id: string) {
    await this.database.delete(schema.outbox).where(eq(schema.outbox.id, id));
  }

  async updateAttempts(id: string, attempts: number) {
    await this.database
      .update(schema.outbox)
      .set({
        attempts,
        lastAttemptedAt: new Date(),
      })
      .where(eq(schema.outbox.id, id));
  }

  async enqueueDelivery(outboxId: string) {
    await this.outboxQueue.add(OUTBOX_JOB, { outboxId }, { jobId: outboxId });
  }
}
