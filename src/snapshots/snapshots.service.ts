import * as schema from '../database/schema';
import { Inject, Injectable } from '@nestjs/common';
import { DATABASE_CONNECTION } from '../database/database-connection';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';

@Injectable()
export class SnapshotsService {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly database: NodePgDatabase<typeof schema>,
  ) {}

  async getLatestSnapshot(
    documentId: string,
  ): Promise<typeof schema.snapshots.$inferSelect | null> {
    const [row] = await this.database
      .select({ snapshot: schema.snapshots })
      .from(schema.documents)
      .innerJoin(
        schema.snapshots,
        eq(schema.documents.latestSnapshotId, schema.snapshots.id),
      )
      .where(eq(schema.documents.id, documentId));

    return row?.snapshot ?? null;
  }
}
