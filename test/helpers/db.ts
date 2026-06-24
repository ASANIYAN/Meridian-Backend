import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import * as schema from '../../src/database/schema';
import { createClient } from 'redis';

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

// Flushes the entire test Redis DB so throttle counters and blacklisted tokens
// don't bleed between tests. Only call this in the test environment.
export async function flushRedis(): Promise<void> {
  const client = createClient({ url: process.env.REDIS_URL });
  await client.connect();
  await client.flushDb();
  await client.quit();
}
