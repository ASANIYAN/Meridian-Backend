import { Module } from '@nestjs/common';
import { OutboxService } from './outbox.service';
import { OutboxController } from './outbox.controller';

@Module({
  controllers: [OutboxController],
  providers: [OutboxService],
})
export class OutboxModule {}
