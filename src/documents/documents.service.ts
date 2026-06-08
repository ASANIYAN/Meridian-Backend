import * as schema from '../database/schema';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { DATABASE_CONNECTION } from '../database/database-connection';
import { eq } from 'drizzle-orm';

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly database: NodePgDatabase<typeof schema>,
  ) {}

  async getDocumentById(id: string) {
    const result = await this.database
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, id));

    return result[0];
  }
}
