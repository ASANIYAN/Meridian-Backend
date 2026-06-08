import { Module } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
import { MembershipsModule } from '../memberships/memberships.module';
import {
  DocumentExistsGuard,
  DocumentMembershipGuard,
} from './documents.guards';

@Module({
  imports: [MembershipsModule],
  providers: [DocumentsService, DocumentExistsGuard, DocumentMembershipGuard],
  controllers: [DocumentsController],
})
export class DocumentsModule {}
