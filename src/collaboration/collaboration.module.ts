import { Module } from '@nestjs/common';
import { CollaborationGateway } from './collaboration.gateway';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ConfigModule],
  providers: [CollaborationGateway],
  controllers: [],
  exports: [CollaborationGateway],
})
export class CollaborationModule {}
