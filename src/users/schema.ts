import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),

  email: text('email').notNull().unique(),

  firstName: text('first_name').notNull(),

  lastName: text('last_name').notNull(),

  passwordHash: text('password_hash').notNull(),

  verifiedAt: timestamp('verified_at', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),

  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});
