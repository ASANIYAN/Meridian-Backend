import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, isNull, ne } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DATABASE_CONNECTION } from '../database/database-connection';
import * as schema from '../database/schema';

@Injectable()
export class PasswordResetTokensService {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly database: NodePgDatabase<typeof schema>,
  ) {}

  async createToken(data: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }) {
    const [token] = await this.database
      .insert(schema.passwordResetTokens)
      .values(data)
      .returning();

    return token;
  }

  async getActiveTokensByUserId(userId: string) {
    return this.database
      .select()
      .from(schema.passwordResetTokens)
      .where(
        and(
          eq(schema.passwordResetTokens.userId, userId),
          isNull(schema.passwordResetTokens.consumedAt),
          isNull(schema.passwordResetTokens.revokedAt),
          gt(schema.passwordResetTokens.expiresAt, new Date()),
        ),
      );
  }

  async revokeActiveTokensForUser(userId: string) {
    await this.database
      .update(schema.passwordResetTokens)
      .set({
        revokedAt: new Date(),
      })
      .where(
        and(
          eq(schema.passwordResetTokens.userId, userId),
          isNull(schema.passwordResetTokens.consumedAt),
          isNull(schema.passwordResetTokens.revokedAt),
          gt(schema.passwordResetTokens.expiresAt, new Date()),
        ),
      );
  }

  async markTokenAsConsumed(tokenId: string) {
    await this.database
      .update(schema.passwordResetTokens)
      .set({
        consumedAt: new Date(),
      })
      .where(eq(schema.passwordResetTokens.id, tokenId));
  }

  async revokeOtherActiveTokensForUser(userId: string, tokenId: string) {
    await this.database
      .update(schema.passwordResetTokens)
      .set({
        revokedAt: new Date(),
      })
      .where(
        and(
          eq(schema.passwordResetTokens.userId, userId),
          ne(schema.passwordResetTokens.id, tokenId),
          isNull(schema.passwordResetTokens.consumedAt),
          isNull(schema.passwordResetTokens.revokedAt),
          gt(schema.passwordResetTokens.expiresAt, new Date()),
        ),
      );
  }
}
