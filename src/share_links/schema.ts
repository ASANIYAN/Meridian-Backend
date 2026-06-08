import { sql } from 'drizzle-orm';
import { pgTable, uuid, boolean, timestamp } from 'drizzle-orm/pg-core';
import { users } from '../users/schema';
import { documents } from '../documents/schema';
import { membershipRoleEnum } from '../memberships/schema';

export const shareLinks = pgTable('share_links', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),

  documentId: uuid('document_id')
    .notNull()
    .references(() => documents.id, { onDelete: 'cascade' }),

  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),

  role: membershipRoleEnum('role').notNull(),

  token: uuid('token')
    .notNull()
    .default(sql`gen_random_uuid()`)
    .unique(),

  isSingleUse: boolean('is_single_use').default(false).notNull(),

  claimedBy: uuid('claimed_by').references(() => users.id),

  claimedAt: timestamp('claimed_at', { withTimezone: true }),

  expiresAt: timestamp('expires_at', { withTimezone: true }),

  revokedAt: timestamp('revoked_at', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});
