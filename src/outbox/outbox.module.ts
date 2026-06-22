import { Module } from '@nestjs/common';
import { OutboxService } from './outbox.service';
import { OutboxController } from './outbox.controller';
import { OutboxProcessor } from './outbox.processor';
import { DatabaseModule } from '../database/database.module';
import { ConfigModule } from '@nestjs/config';
import { RedisModule } from '../redis/redis.module';
import { BullModule } from '@nestjs/bullmq';
import { OUTBOX_QUEUE } from './outbox.queue';

@Module({
  imports: [
    DatabaseModule,
    ConfigModule,
    RedisModule,
    BullModule.registerQueue({ name: OUTBOX_QUEUE }),
  ],
  controllers: [OutboxController],
  providers: [OutboxService, OutboxProcessor],
  exports: [OutboxService],
})
export class OutboxModule {}
