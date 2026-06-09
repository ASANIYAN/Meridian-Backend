import { Module } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
import { MembershipsModule } from '../memberships/memberships.module';
import {
  DocumentExistsGuard,
  DocumentMembershipGuard,
  DocumentWriteAccessGuard,
} from './documents.guards';
import { DatabaseModule } from '../database/database.module';
import { RedisService } from '../redis/redis.service';

@Module({
  imports: [DatabaseModule, MembershipsModule],
  providers: [
    DocumentsService,
    DocumentExistsGuard,
    DocumentMembershipGuard,
    DocumentWriteAccessGuard,
    RedisService,
  ],
  controllers: [DocumentsController],
})
export class DocumentsModule {}
