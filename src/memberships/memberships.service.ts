import * as schema from '../database/schema';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { DATABASE_CONNECTION } from '../database/database-connection';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, eq } from 'drizzle-orm';

@Injectable()
export class MembershipsService {
  private readonly logger = new Logger(MembershipsService.name);
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly database: NodePgDatabase<typeof schema>,
  ) {}

  async getUserDocumentMembership(documentId: string, userId: string) {
    const result = await this.database
      .select()
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.documentId, documentId),
          eq(schema.memberships.userId, userId),
        ),
      );

    return result[0];
  }
}
