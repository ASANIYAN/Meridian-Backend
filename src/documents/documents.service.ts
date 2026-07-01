import * as schema from '../database/schema';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DATABASE_CONNECTION } from '../database/database-connection';
import { and, desc, eq, getTableColumns, ne, sql } from 'drizzle-orm';
import { MembershipsService } from '../memberships/memberships.service';
import { ShareLinksService } from '../share_links/share_links.service';
import { UsersService } from '../users/users.service';
import { MailService } from '../mail/mail.service';

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
    private readonly membershipsService: MembershipsService,
    private readonly sharelinksService: ShareLinksService,
    private readonly usersService: UsersService,
    private readonly mailService: MailService,
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
    // Shared predicate for the page query and its count so the two can't drift.
    const membershipFilter = and(
      eq(schema.memberships.userId, userId),
      ne(schema.documents.status, 'deleted'),
    );

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
      .where(membershipFilter)
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
      .where(membershipFilter);
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

  async getDocumentMembers(documentId: string) {
    return this.database
      .select({
        id: schema.users.id,
        firstName: schema.users.firstName,
        lastName: schema.users.lastName,
        role: schema.memberships.role,
        membershipMode: schema.memberships.membershipMode,
        createdAt: schema.memberships.createdAt,
      })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.memberships.userId, schema.users.id))
      .where(eq(schema.memberships.documentId, documentId));
  }

  async addDocumentMember(
    documentId: string,
    email: string,
    role: 'editor' | 'viewer',
    inviterId: string,
  ) {
    const member = await this.membershipsService.addMember(
      documentId,
      email,
      role,
    );

    void this.sendDocumentInvitationEmail(documentId, email, role, inviterId);

    return member;
  }

  private async sendDocumentInvitationEmail(
    documentId: string,
    email: string,
    role: 'editor' | 'viewer',
    inviterId: string,
  ) {
    try {
      const [document, inviter] = await Promise.all([
        this.getDocumentById(documentId),
        this.usersService.getUserById(inviterId),
      ]);

      const inviterName =
        [inviter.firstName, inviter.lastName].filter(Boolean).join(' ') ||
        inviter.email;

      await this.mailService.sendDocumentInvitationEmail(
        email,
        inviterName,
        document.title,
        role,
        documentId,
      );
    } catch (error) {
      this.logger.error(
        `Failed to send document invitation email to ${email}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  async updateDocumentMemberRole(
    documentId: string,
    targetUserId: string,
    callerUserId: string,
    role: 'editor' | 'viewer',
  ) {
    if (targetUserId === callerUserId) {
      throw new BadRequestException('Cannot change your own role');
    }

    const targetMembership =
      await this.membershipsService.getUserDocumentMembership(
        documentId,
        targetUserId,
      );

    if (!targetMembership) {
      throw new NotFoundException('Member not found');
    }

    const updatedMembership = await this.membershipsService.updateMemberRole(
      documentId,
      targetUserId,
      role,
    );

    return updatedMembership;
  }

  async removeDocumentMember(
    documentId: string,
    targetUserId: string,
    callerUserId: string,
  ) {
    if (targetUserId === callerUserId) {
      throw new BadRequestException('Author cannot remove themselves');
    }

    const targetMembership =
      await this.membershipsService.getUserDocumentMembership(
        documentId,
        targetUserId,
      );

    if (!targetMembership) {
      throw new NotFoundException('Member not found');
    }

    await this.membershipsService.removeMember(documentId, targetUserId);
  }

  async claimShareLink(documentId: string, token: string, userId: string) {
    // Validate, add the membership, and mark a single-use link claimed as one atomic
    // unit so a concurrent claimer can't slip between validation and claim. The link
    // is validated with a row lock (FOR UPDATE) inside this transaction, so two
    // simultaneous claims of the same single-use link serialize and the loser is
    // rejected when it re-reads the now-claimed row.
    const membership = await this.database.transaction(async (tx) => {
      const link = await this.sharelinksService.findAndValidateLink(
        documentId,
        token,
        tx,
      );

      const member = await this.membershipsService.addMemberViaLink(
        documentId,
        userId,
        link.role as 'editor' | 'viewer',
        tx,
      );

      if (link.isSingleUse) {
        await this.sharelinksService.markLinkAsClaimed(link.id, userId, tx);
      }

      return member;
    });

    const document = await this.getDocumentById(documentId);

    return { membership, document };
  }
}
