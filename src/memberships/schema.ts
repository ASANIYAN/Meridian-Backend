import { sql } from 'drizzle-orm';
import { pgTable, uuid, timestamp, pgEnum, unique } from 'drizzle-orm/pg-core';
import { documents } from '../documents/schema';
import { users } from '../users/schema';

export const membershipRoleEnum = pgEnum('membership_role', [
  'author',
  'editor',
  'viewer',
]);
export const membershipModeEnum = pgEnum('membership_mode', ['invite', 'link']);

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),

    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    role: membershipRoleEnum('role').notNull(),

    membershipMode: membershipModeEnum('membership_mode').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),

    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    // Composite unique constraint: prevents a user from having multiple roles in one doc
    unq: unique().on(table.documentId, table.userId),
  }),
);
