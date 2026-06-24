import * as path from 'path';
import * as dotenv from 'dotenv';
import { Client } from 'pg';
import { execSync } from 'child_process';

export default async function globalSetup() {
  dotenv.config({ path: path.resolve(__dirname, '../../.env.test') });

  const testDbUrl = process.env.DB_URL!;
  const url = new URL(testDbUrl);
  const testDbName = url.pathname.slice(1);

  // Connect to the dev DB to create the test DB if it doesn't exist
  const adminUrl = new URL(testDbUrl);
  adminUrl.pathname = '/meridian';

  const client = new Client({ connectionString: adminUrl.toString() });
  await client.connect();

  const { rows } = await client.query(
    'SELECT 1 FROM pg_database WHERE datname = $1',
    [testDbName],
  );

  if (rows.length === 0) {
    await client.query(`CREATE DATABASE "${testDbName}"`);
  }

  await client.end();

  // Sync schema to test DB
  execSync(
    `npx drizzle-kit push --config=${path.resolve(__dirname, '../../drizzle.config.test.ts')}`,
    { stdio: 'inherit', env: { ...process.env } },
  );
}
