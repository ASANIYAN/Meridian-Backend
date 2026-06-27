import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { eq, sql, type AnyColumn } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { hashSync } from 'bcryptjs';
import * as Y from 'yjs';
import { envValidationSchema } from '../config/env.validation';
import {
  documents,
  memberships,
  operations,
  shareLinks,
  snapshots,
  users,
} from './schema';
import * as schema from './schema';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      validationOptions: {
        abortEarly: false,
      },
    }),
  ],
})
class SeedConfigModule {}

const logger = new Logger('DatabaseSeed');
const seedTimestamp = new Date('2026-01-01T00:00:00.000Z');
const testPassword = 'Password123!';
const testPasswordSalt = '$2b$10$l.k/d5mdebQ1EjF2KDH9XO';
const testPasswordHash = hashSync(testPassword, testPasswordSalt);

const seedUsers = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'author@meridian.dev',
    firstName: 'Amina',
    lastName: 'Author',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    email: 'editor@meridian.dev',
    firstName: 'Evan',
    lastName: 'Editor',
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    email: 'viewer@meridian.dev',
    firstName: 'Vera',
    lastName: 'Viewer',
  },
];

const seedDocuments = [
  {
    id: '44444444-4444-4444-8444-444444444444',
    title: 'Meridian Product Brief',
  },
  {
    id: '55555555-5555-4555-8555-555555555555',
    title: 'Launch Planning Notes',
  },
];

const seedShareLinkTokens = [
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
];

const seedMembershipIds = {
  productBriefAuthor: '10101010-1010-4010-8010-101010101010',
  productBriefEditor: '20202020-2020-4020-8020-202020202020',
  productBriefViewer: '30303030-3030-4030-8030-303030303030',
  launchPlanAuthor: '40404040-4040-4040-8040-404040404040',
  launchPlanEditor: '50505050-5050-4050-8050-505050505050',
  launchPlanViewer: '60606060-6060-4060-8060-606060606060',
};

// Snapshots store a real Yjs binary update (encodeStateAsUpdate), not arbitrary
// JSON. The snapshot worker and the join flow replay this blob via Y.applyUpdate,
// which throws on anything that isn't a valid Yjs update.
function buildContentBlob(text: string): Buffer {
  const doc = new Y.Doc();
  doc.getText('content').insert(0, text);
  return Buffer.from(Y.encodeStateAsUpdate(doc));
}

function getRequiredMapValue<TValue>(
  map: Map<string, TValue>,
  key: string,
): TValue {
  const value = map.get(key);

  if (!value) {
    throw new Error(`Seed value was not returned for key: ${key}`);
  }

  return value;
}

async function seedDatabase() {
  const app = await NestFactory.createApplicationContext(SeedConfigModule, {
    logger: ['log', 'error', 'warn'],
  });

  const configService = app.get(ConfigService);
  const pool = new Pool({
    connectionString: configService.getOrThrow<string>('DB_URL'),
  });
  const database = drizzle(pool, { schema });

  try {
    await database.transaction(async (tx) => {
      const seededUsers = await tx
        .insert(users)
        .values(
          seedUsers.map((user) => ({
            ...user,
            passwordHash: testPasswordHash,
            verifiedAt: seedTimestamp,
            createdAt: seedTimestamp,
            updatedAt: seedTimestamp,
          })),
        )
        .onConflictDoUpdate({
          target: users.email,
          set: {
            firstName: sqlExcluded(users.firstName),
            lastName: sqlExcluded(users.lastName),
            passwordHash: testPasswordHash,
            verifiedAt: seedTimestamp,
            updatedAt: seedTimestamp,
          },
        })
        .returning({
          id: users.id,
          email: users.email,
        });

      const userIdsByEmail = new Map(
        seededUsers.map((user) => [user.email, user.id]),
      );
      const authorId = getRequiredMapValue(
        userIdsByEmail,
        'author@meridian.dev',
      );
      const editorId = getRequiredMapValue(
        userIdsByEmail,
        'editor@meridian.dev',
      );
      const viewerId = getRequiredMapValue(
        userIdsByEmail,
        'viewer@meridian.dev',
      );

      await tx
        .insert(documents)
        .values(
          seedDocuments.map((document) => ({
            ...document,
            status: 'active' as const,
            createdBy: authorId,
            createdAt: seedTimestamp,
            updatedAt: seedTimestamp,
          })),
        )
        .onConflictDoUpdate({
          target: documents.id,
          set: {
            title: sqlExcluded(documents.title),
            status: 'active',
            createdBy: authorId,
            updatedAt: seedTimestamp,
          },
        });

      const membershipRows = seedDocuments.flatMap((document, index) => [
        {
          id:
            index === 0
              ? seedMembershipIds.productBriefAuthor
              : seedMembershipIds.launchPlanAuthor,
          documentId: document.id,
          userId: authorId,
          role: 'author' as const,
          membershipMode: 'invite' as const,
        },
        {
          id:
            index === 0
              ? seedMembershipIds.productBriefEditor
              : seedMembershipIds.launchPlanEditor,
          documentId: document.id,
          userId: editorId,
          role: 'editor' as const,
          membershipMode: 'invite' as const,
        },
        {
          id:
            index === 0
              ? seedMembershipIds.productBriefViewer
              : seedMembershipIds.launchPlanViewer,
          documentId: document.id,
          userId: viewerId,
          role: 'viewer' as const,
          membershipMode: 'link' as const,
        },
      ]);

      await tx
        .insert(memberships)
        .values(
          membershipRows.map((membership) => ({
            ...membership,
            createdAt: seedTimestamp,
            updatedAt: seedTimestamp,
          })),
        )
        .onConflictDoUpdate({
          target: [memberships.documentId, memberships.userId],
          set: {
            role: sqlExcluded(memberships.role),
            membershipMode: sqlExcluded(memberships.membershipMode),
            updatedAt: seedTimestamp,
          },
        });

      const operationRows = [
        {
          id: '66666666-6666-4666-8666-666666666661',
          documentId: seedDocuments[0].id,
          userId: authorId,
          type: 'insert' as const,
          afterId: null,
          clockValue: 1n,
          payload: {
            insert_id: 'brief-title',
            content: 'Meridian product brief',
          },
        },
        {
          id: '66666666-6666-4666-8666-666666666662',
          documentId: seedDocuments[0].id,
          userId: editorId,
          type: 'format' as const,
          afterId: '66666666-6666-4666-8666-666666666661',
          clockValue: 2n,
          payload: {
            start_id: 'brief-title',
            end_id: 'brief-title',
            formatting: { heading: 1, bold: true },
          },
        },
        {
          id: '77777777-7777-4777-8777-777777777771',
          documentId: seedDocuments[1].id,
          userId: authorId,
          type: 'insert' as const,
          afterId: null,
          clockValue: 1n,
          payload: {
            insert_id: 'launch-overview',
            content: 'Launch plan overview',
          },
        },
        {
          id: '77777777-7777-4777-8777-777777777772',
          documentId: seedDocuments[1].id,
          userId: editorId,
          type: 'insert' as const,
          afterId: '77777777-7777-4777-8777-777777777771',
          clockValue: 2n,
          payload: {
            insert_id: 'launch-checklist',
            content: 'Finalize beta invite list',
          },
        },
      ];

      const seededOperations: Array<{
        documentId: string;
        operationSequence: number;
      }> = [];

      for (const operation of operationRows) {
        const [seededOperation] = await tx
          .insert(operations)
          .values({
            ...operation,
            payload: operation.payload,
            createdAt: seedTimestamp,
          })
          .onConflictDoUpdate({
            target: operations.id,
            set: {
              documentId: operation.documentId,
              userId: operation.userId,
              type: operation.type,
              afterId: operation.afterId,
              clockValue: operation.clockValue,
              payload: operation.payload,
              createdAt: seedTimestamp,
            },
          })
          .returning({
            documentId: operations.documentId,
            operationSequence: operations.operationSequence,
          });

        if (!seededOperation) {
          throw new Error(`Operation was not returned: ${operation.id}`);
        }

        seededOperations.push(seededOperation);
      }

      const latestSequenceByDocumentId = new Map<string, number>();

      for (const operation of seededOperations) {
        const currentSequence = latestSequenceByDocumentId.get(
          operation.documentId,
        );

        if (
          currentSequence === undefined ||
          operation.operationSequence > currentSequence
        ) {
          latestSequenceByDocumentId.set(
            operation.documentId,
            operation.operationSequence,
          );
        }
      }

      const snapshotRows = seedDocuments.map((document, index) => ({
        id:
          index === 0
            ? '88888888-8888-4888-8888-888888888881'
            : '99999999-9999-4999-8999-999999999991',
        documentId: document.id,
        contentBlob: buildContentBlob(
          index === 0
            ? 'A concise product brief for local development.'
            : 'A practical launch checklist for local development.',
        ),
        versionVector: {
          author: getRequiredMapValue(latestSequenceByDocumentId, document.id),
          editor: getRequiredMapValue(latestSequenceByDocumentId, document.id),
        },
        operationSequence: getRequiredMapValue(
          latestSequenceByDocumentId,
          document.id,
        ),
      }));

      await tx
        .insert(snapshots)
        .values(
          snapshotRows.map((snapshot) => ({
            ...snapshot,
            createdAt: seedTimestamp,
          })),
        )
        .onConflictDoUpdate({
          target: snapshots.id,
          set: {
            documentId: sqlExcluded(snapshots.documentId),
            contentBlob: sqlExcluded(snapshots.contentBlob),
            versionVector: sqlExcluded(snapshots.versionVector),
            operationSequence: sqlExcluded(snapshots.operationSequence),
            createdAt: seedTimestamp,
          },
        });

      for (const snapshot of snapshotRows) {
        await tx
          .update(documents)
          .set({
            latestSnapshotId: snapshot.id,
            updatedAt: seedTimestamp,
          })
          .where(eq(documents.id, snapshot.documentId));
      }

      await tx
        .insert(shareLinks)
        .values(
          seedDocuments.map((document, index) => ({
            id:
              index === 0
                ? 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
                : 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            documentId: document.id,
            createdBy: authorId,
            role: index === 0 ? ('editor' as const) : ('viewer' as const),
            token: seedShareLinkTokens[index],
            isSingleUse: false,
            createdAt: seedTimestamp,
          })),
        )
        .onConflictDoUpdate({
          target: shareLinks.token,
          set: {
            documentId: sqlExcluded(shareLinks.documentId),
            createdBy: authorId,
            role: sqlExcluded(shareLinks.role),
            isSingleUse: false,
          },
        });
    });

    logger.log('Seeded local development data.');
    logger.log(`Test users: ${seedUsers.map((user) => user.email).join(', ')}`);
    logger.log(`Test password: ${testPassword}`);
  } finally {
    await pool.end();
    await app.close();
  }
}

function sqlExcluded(column: AnyColumn) {
  return sql.raw(`excluded.${quoteIdentifier(column.name)}`);
}

function quoteIdentifier(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

void seedDatabase().catch((error: unknown) => {
  const message =
    error instanceof AggregateError
      ? error.errors.map((nestedError) => String(nestedError)).join('\n')
      : error instanceof Error
        ? error.message
        : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  Logger.error(message, stack, 'DatabaseSeed');
  process.exitCode = 1;
});
