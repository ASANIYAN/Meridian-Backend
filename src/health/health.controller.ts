import { Controller, Get, Inject } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';
import { sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
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
    private readonly health: HealthCheckService,
    @Inject(DATABASE_CONNECTION)
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly redis: RedisService,
  ) {}

  @Get()
  @HealthCheck()
  @ApiOperation({
    summary: 'Health check',
    description:
      'Returns database and Redis availability. Used by load balancers and monitoring tools.',
  })
  check() {
    return this.health.check([
      async () => {
        await this.db.execute(sql`SELECT 1`);
        return { database: { status: 'up' as const } };
      },
      async () => {
        await this.redis.ping();
        return { redis: { status: 'up' as const } };
      },
    ]);
  }
}
