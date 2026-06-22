import { Module } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
import { MembershipsModule } from '../memberships/memberships.module';
import {
  DocumentAuthorGuard,
  DocumentExistsGuard,
  DocumentMembershipGuard,
  DocumentWriteAccessGuard,
} from './documents.guards';
import { DatabaseModule } from '../database/database.module';
import { RedisService } from '../redis/redis.service';
import { ShareLinksModule } from '../share_links/share_links.module';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [DatabaseModule, MembershipsModule, ShareLinksModule, AiModule],
  providers: [
    DocumentsService,
    DocumentExistsGuard,
    DocumentMembershipGuard,
    DocumentWriteAccessGuard,
    DocumentAuthorGuard,
    RedisService,
  ],
  controllers: [DocumentsController],
})
export class DocumentsModule {}
