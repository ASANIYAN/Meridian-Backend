import * as schema from '../database/schema';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { DATABASE_CONNECTION } from '../database/database-connection';
import { and, desc, eq, getTableColumns, ne, sql } from 'drizzle-orm';

type DocumentWithRole = typeof schema.documents.$inferSelect & {
  role: (typeof schema.membershipRoleEnum.enumValues)[number];
};

type PaginatedResult<T> = {
  data: T[];
  meta: { page: number; limit: number; total: number; totalPages: number };
};

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

  async createDocument(title: string, userId: string) {
    return await this.database.transaction(async (tx) => {
      const [document] = await tx
        .insert(schema.documents)
        .values({ title, createdBy: userId })
        .returning();

      await tx.insert(schema.memberships).values({
        documentId: document.id,
        userId,
        role: 'author',
        membershipMode: 'invite',
      });

      return document;
    });
  }

  async listUserDocumentsWithRole(
    userId: string,
    page: number,
    limit: number,
  ): Promise<PaginatedResult<DocumentWithRole>> {
    const documentWithRole = await this.database
      .select({
        ...getTableColumns(schema.documents),
        role: schema.memberships.role,
      })
      .from(schema.memberships)
      .innerJoin(
        schema.documents,
        eq(schema.memberships.documentId, schema.documents.id),
      )
      .where(
        and(
          eq(schema.memberships.userId, userId),
          ne(schema.documents.status, 'deleted'),
        ),
      )
      .orderBy(desc(schema.documents.updatedAt))
      .limit(limit)
      .offset((page - 1) * limit);

    const count = await this.database
      .select({ count: sql<number>`count(*)` })
      .from(schema.memberships)
      .innerJoin(
        schema.documents,
        eq(schema.memberships.documentId, schema.documents.id),
      )
      .where(
        and(
          eq(schema.memberships.userId, userId),
          ne(schema.documents.status, 'deleted'),
        ),
      );
    const total = Number(count[0].count);

    const totalPages = Math.ceil(total / limit);

    return { data: documentWithRole, meta: { page, limit, total, totalPages } };
  }

  async getDocumentWithMemberCount(documentId: string) {
    const documentRow = await this.getDocumentById(documentId);

    const result = await this.database
      .select({ count: sql<number>`count(*)` })
      .from(schema.memberships)
      .where(eq(schema.memberships.documentId, documentId));

    const memberCount = Number(result[0].count);

    return { ...documentRow, memberCount };
  }

  async updateDocumentTitle(documentId: string, title: string) {
    const [document] = await this.database
      .update(schema.documents)
      .set({ title, updatedAt: new Date() })
      .where(eq(schema.documents.id, documentId))
      .returning();

    return document;
  }

  async softDeleteDocument(documentId: string) {
    await this.database
      .update(schema.documents)
      .set({ status: 'deleted', updatedAt: new Date() })
      .where(eq(schema.documents.id, documentId));
  }

  async updateDocumentStatus(
    documentId: string,
    status: 'active' | 'inactive',
  ) {
    const [document] = await this.database
      .update(schema.documents)
      .set({ status, updatedAt: new Date() })
      .where(eq(schema.documents.id, documentId))
      .returning();

    return document;
  }
}
