import * as schema from '../database/schema';
import { Inject, Injectable } from '@nestjs/common';
import { DATABASE_CONNECTION } from '../database/database-connection';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, asc, count, eq, gt } from 'drizzle-orm';

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

  async insertOperation(
    db: NodePgDatabase<typeof schema>,
    data: { documentId: string; userId: string; yjsUpdate: Buffer },
  ) {
    const [result] = await db
      .insert(schema.operations)
      .values({
        documentId: data.documentId,
        userId: data.userId,
        type: 'yjs_update',
        yjsUpdate: data.yjsUpdate,
        clockValue: null,
        payload: null,
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
