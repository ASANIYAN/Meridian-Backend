import * as schema from '../database/schema';
import { Inject, Injectable } from '@nestjs/common';
import { DATABASE_CONNECTION } from '../database/database-connection';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, asc, eq, gt } from 'drizzle-orm';

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
}
