import { Module } from '@nestjs/common';
import { MembershipsService } from './memberships.service';
import { DatabaseModule } from '../database/database.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [DatabaseModule, UsersModule],
  providers: [MembershipsService],
  exports: [MembershipsService],
})
export class MembershipsModule {}
