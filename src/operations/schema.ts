import {
  pgTable,
  uuid,
  integer,
  bigint,
  jsonb,
  timestamp,
  pgEnum,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { documents } from '../documents/schema';
import { users } from '../users/schema';
import { bytea } from '../common/db/custom-types';

// operation types for the CRDT logic
export const operationTypeEnum = pgEnum('operation_type', [
  'insert',
  'delete',
  'format',
  'yjs_update',
]);

// who generated the operation
export const operationSourceEnum = pgEnum('operation_source', ['human', 'ai']);

export const operations = pgTable(
  'operations',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),

    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),

    type: operationTypeEnum('type').notNull(),

    yjsUpdate: bytea('yjs_update').default(sql`null`),

    // The content-addressable reference for CRDT positioning
    afterId: uuid('after_id'),

    // Database-assigned sequence for delta syncs
    operationSequence: integer('operation_sequence')
      .generatedAlwaysAsIdentity()
      .notNull(),

    // Lamport timestamp for causal ordering
    clockValue: bigint('clock_value', { mode: 'bigint' }),

    source: operationSourceEnum('source').notNull().default('human'),

    // Polymorphic payload (validated via Zod); null for yjs_update rows
    payload: jsonb('payload'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    // UNIQUE constraint to prevent sequence collisions per document
    docSeqUnq: unique().on(table.documentId, table.operationSequence),

    // High-performance index for fetching deltas (Document Load/Sync)
    docSeqIdx: index('doc_seq_idx').on(
      table.documentId,
      table.operationSequence,
    ),
  }),
);
