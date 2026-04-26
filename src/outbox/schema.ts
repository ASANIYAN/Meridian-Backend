import { sql } from 'drizzle-orm';
import { index } from 'drizzle-orm/pg-core';
import { operations } from '../operations/schema';
import { integer, timestamp, uuid, pgTable } from 'drizzle-orm/pg-core';
import { bytea } from '../common/db/custom-types';

export const outbox = pgTable(
  'outbox',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    documentId: uuid('document_id').notNull(),
    operationId: uuid('operation_id')
      .notNull()
      .references(() => operations.id),
    payload: bytea('payload').notNull(),
    attempts: integer('attempts').default(0).notNull(),
    lastAttemptedAt: timestamp('last_attempted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('outbox_worker_idx').on(table.attempts, table.lastAttemptedAt),
  ],
);
