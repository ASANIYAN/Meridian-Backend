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

  async createSnapshot(
    documentId: string,
    contentBlob: Buffer,
    versionVector: Record<string, number>,
    operationSequence: number,
  ): Promise<void> {
    await this.database.transaction(async (tx) => {
      const [snapshot] = await tx
        .insert(schema.snapshots)
        .values({ documentId, contentBlob, versionVector, operationSequence })
        .returning({ id: schema.snapshots.id });

      await tx
        .update(schema.documents)
        .set({ latestSnapshotId: snapshot.id })
        .where(eq(schema.documents.id, documentId));
    });
  }
}
