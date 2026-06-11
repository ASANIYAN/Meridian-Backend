import * as schema from '../database/schema';
import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
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

  async addMember(
    documentId: string,
    email: string,
    role: 'editor' | 'viewer',
  ) {
    const [user] = await this.database
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email));

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    const [existing] = await this.database
      .select()
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.documentId, documentId),
          eq(schema.memberships.userId, user.id),
        ),
      );

    if (existing) {
      throw new ConflictException('User is already a member of this document.');
    }

    const [membership] = await this.database
      .insert(schema.memberships)
      .values({ documentId, userId: user.id, role, membershipMode: 'invite' })
      .returning();

    this.logger.log(`Added member ${user.id} to document ${documentId}`);

    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      role: membership.role,
      membershipMode: membership.membershipMode,
      createdAt: membership.createdAt,
    };
  }
}
