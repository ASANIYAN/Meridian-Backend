import { ConfigService } from '@nestjs/config';
import { defineConfig } from 'drizzle-kit';

const configService = new ConfigService();

export default defineConfig({
  schema: './src/database/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: configService.getOrThrow<string>('DB_URL'),
  },
});
