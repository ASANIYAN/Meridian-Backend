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
import { UsersService } from '../users/users.service';

@Injectable()
export class MembershipsService {
  private readonly logger = new Logger(MembershipsService.name);
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly database: NodePgDatabase<typeof schema>,
    private readonly usersService: UsersService,
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
    const user = await this.usersService.getUserByEmail(email);

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    const [membership] = await this.database
      .insert(schema.memberships)
      .values({ documentId, userId: user.id, role, membershipMode: 'invite' })
      .onConflictDoNothing()
      .returning();

    if (!membership) {
      throw new ConflictException('User is already a member of this document.');
    }

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

  async updateMemberRole(
    documentId: string,
    userId: string,
    role: 'editor' | 'viewer',
  ) {
    const [membership] = await this.database
      .update(schema.memberships)
      .set({ role, updatedAt: new Date() })
      .where(
        and(
          eq(schema.memberships.documentId, documentId),
          eq(schema.memberships.userId, userId),
        ),
      )
      .returning();

    if (!membership) {
      throw new NotFoundException('Member not found');
    }

    const [user] = await this.database
      .select({
        id: schema.users.id,
        firstName: schema.users.firstName,
        lastName: schema.users.lastName,
      })
      .from(schema.users)
      .where(eq(schema.users.id, userId));

    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      role: membership.role,
      membershipMode: membership.membershipMode,
      createdAt: membership.createdAt,
    };
  }

  async removeMember(documentId: string, userId: string) {
    await this.database
      .delete(schema.memberships)
      .where(
        and(
          eq(schema.memberships.documentId, documentId),
          eq(schema.memberships.userId, userId),
        ),
      );
  }
}
