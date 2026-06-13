import { Module } from '@nestjs/common';
import { CollaborationGateway } from './collaboration.gateway';
import { ConfigModule } from '@nestjs/config';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [ConfigModule, RedisModule],
  providers: [CollaborationGateway],
  controllers: [],
  exports: [CollaborationGateway],
})
export class CollaborationModule {}
