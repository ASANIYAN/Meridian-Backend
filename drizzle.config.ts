import { defineConfig } from 'drizzle-kit';
import 'dotenv/config';

const { DB_URL } = process.env;
if (!DB_URL) throw new Error('DB_URL environment variable is not set');

export default defineConfig({
  schema: './src/database/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: DB_URL,
  },
});
