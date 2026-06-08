import { sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { users } from '../users/schema';
import {
  pgTable,
  text,
  timestamp,
  uuid,
  pgEnum,
  integer,
  jsonb,
} from 'drizzle-orm/pg-core';
import { bytea } from '../common/db/custom-types';

export const documentStatusEnum = pgEnum('document_status', [
  'draft',
  'active',
  'inactive',
  'deleted',
]);

export const documents = pgTable('documents', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),

  title: text('title').notNull(),

  status: documentStatusEnum('status').notNull().default('draft'),

  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),

  latestSnapshotId: uuid('latest_snapshot_id').references(
    (): AnyPgColumn => snapshots.id,
  ),

  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),

  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const snapshots = pgTable('snapshots', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),

  documentId: uuid('document_id')
    .notNull()
    .references((): AnyPgColumn => documents.id),

  // Stores the Y.encodeStateAsUpdate binary data
  contentBlob: bytea('content_blob').notNull(),

  // Maps { client_id: last_op_seq }
  versionVector: jsonb('version_vector')
    .default(sql`'{}'::jsonb`)
    .notNull(),

  operationSequence: integer('operation_sequence').notNull(),

  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});
