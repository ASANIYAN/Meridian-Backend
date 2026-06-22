import * as schema from '../database/schema';
import { Inject, Injectable } from '@nestjs/common';
import { DATABASE_CONNECTION } from '../database/database-connection';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, asc, count, eq, gt, max } from 'drizzle-orm';

@Injectable()
export class OperationsService {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly database: NodePgDatabase<typeof schema>,
  ) {}

  async getOperationsSinceSequence(
    documentId: string,
    afterSequence: number,
  ): Promise<(typeof schema.operations.$inferSelect)[]> {
    return this.database
      .select()
      .from(schema.operations)
      .where(
        and(
          eq(schema.operations.documentId, documentId),
          gt(schema.operations.operationSequence, afterSequence),
        ),
      )
      .orderBy(asc(schema.operations.operationSequence));
  }

  // Serialises concurrent clock assignments for the same document. Without this
  // lock, two transactions running simultaneously both read the same MAX(clock_value)
  // and produce duplicate Lamport timestamps. The documents row is used because it
  // always exists (unlike operations rows on a new document) and gives one mutex
  // per document without blocking writes to other documents.
  async acquireDocumentWriteLock(
    db: NodePgDatabase<typeof schema>,
    documentId: string,
  ): Promise<void> {
    await db
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId))
      .for('update');
  }

  async getMaxClockValue(
    db: NodePgDatabase<typeof schema>,
    documentId: string,
  ): Promise<bigint> {
    const [row] = await db
      .select({ maxClock: max(schema.operations.clockValue) })
      .from(schema.operations)
      .where(eq(schema.operations.documentId, documentId));

    return row?.maxClock ?? 0n;
  }

  async insertOperation(
    db: NodePgDatabase<typeof schema>,
    data: {
      documentId: string;
      userId: string;
      yjsUpdate: Buffer;
      type: 'insert' | 'delete' | 'format' | 'yjs_update';
      source: 'human' | 'ai';
      payload?: Record<string, unknown> | null;
      clockValue: bigint;
    },
  ) {
    const [result] = await db
      .insert(schema.operations)
      .values({
        documentId: data.documentId,
        userId: data.userId,
        type: data.type,
        yjsUpdate: data.yjsUpdate,
        clockValue: data.clockValue,
        source: data.source,
        payload: data.payload,
        afterId: null,
      })
      .returning();

    if (!result) throw new Error('operations insert returned no rows');

    return result;
  }

  async countOperationsSinceSequence(
    documentId: string,
    afterSequence: number,
  ): Promise<number> {
    const [row] = await this.database
      .select({ count: count() })
      .from(schema.operations)
      .where(
        and(
          eq(schema.operations.documentId, documentId),
          gt(schema.operations.operationSequence, afterSequence),
        ),
      );

    return row?.count ?? 0;
  }
}
