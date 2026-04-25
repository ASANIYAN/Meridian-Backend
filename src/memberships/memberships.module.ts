import { Module } from '@nestjs/common';
import { ServiceModule } from './service/service.module';
import { MembershipsService } from './memberships.service';
import { MembershipsController } from './memberships.controller';

@Module({
  imports: [ServiceModule],
  providers: [MembershipsService],
  controllers: [MembershipsController]
})
export class MembershipsModule {}
