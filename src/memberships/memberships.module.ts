import { Module } from '@nestjs/common';
import { MembershipsService } from './memberships.service';
import { MembershipsController } from './memberships.controller';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule],
  providers: [MembershipsService],
  controllers: [MembershipsController],
  exports: [MembershipsService],
})
export class MembershipsModule {}
