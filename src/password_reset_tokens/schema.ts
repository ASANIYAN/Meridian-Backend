import { sql } from 'drizzle-orm';
import { users } from '../users/schema';
import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';

export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    // SHA-256 hash of the secret token
    tokenHash: text('token_hash').notNull(),

    // Mandatory expiry for security
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),

    // Timestamp when the password was actually changed using this token
    consumedAt: timestamp('consumed_at', { withTimezone: true }),

    // Timestamp when the system or user invalidated this token (e.g., requested a new one)
    revokedAt: timestamp('revoked_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    // Index for fast lookup of a user's active tokens during revocation or rate-limiting
    userIdIdx: index('reset_token_user_id_idx').on(table.userId),
  }),
);
