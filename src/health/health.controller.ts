import { Controller, Get, Inject, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { DATABASE_CONNECTION } from '../database/database-connection';
import { RedisService } from '../redis/redis.service';
import * as schema from '../database/schema';

@ApiTags('System')
@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly redis: RedisService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Health check',
    description:
      'Probes PostgreSQL (SELECT 1) and Redis (PING). Returns 200 when both pass, 503 with failed checks identified when either fails.',
  })
  async check(@Res({ passthrough: true }) res: Response) {
    const checks: { database: string; redis: string } = {
      database: 'up',
      redis: 'up',
    };

    await Promise.allSettled([
      this.db.execute(sql`SELECT 1`).catch(() => {
        checks.database = 'down';
      }),
      this.redis.ping().catch(() => {
        checks.redis = 'down';
      }),
    ]);

    const healthy = checks.database === 'up' && checks.redis === 'up';
    res.status(healthy ? 200 : 503);
    return { status: healthy ? 'ok' : 'error', checks };
  }
}
