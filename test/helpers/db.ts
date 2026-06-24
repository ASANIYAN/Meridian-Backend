import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import * as schema from '../../src/database/schema';

let pool: Pool | null = null;
let db: ReturnType<typeof drizzle<typeof schema>> | null = null;

function getDb() {
  if (!db) {
    pool = new Pool({ connectionString: process.env.DB_URL });
    db = drizzle(pool, { schema });
  }
  return db;
}

export async function truncateAll(): Promise<void> {
  await getDb().execute(sql`
    TRUNCATE TABLE
      outbox,
      operations,
      snapshots,
      share_links,
      memberships,
      password_reset_tokens,
      documents,
      users
    RESTART IDENTITY CASCADE
  `);
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    db = null;
  }
}
