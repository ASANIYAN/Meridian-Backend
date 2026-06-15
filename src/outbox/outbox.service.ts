import * as schema from '../database/schema';
import { Inject, Injectable } from '@nestjs/common';
import { DATABASE_CONNECTION } from '../database/database-connection';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

@Injectable()
export class OutboxService {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly database: NodePgDatabase<typeof schema>,
  ) {}

  async insertOutboxEntry(
    db: NodePgDatabase<typeof schema>,
    data: { documentId: string; operationId: string; payload: Buffer },
  ) {
    await db.insert(schema.outbox).values({
      documentId: data.documentId,
      operationId: data.operationId,
      payload: data.payload,
    });
  }
}
