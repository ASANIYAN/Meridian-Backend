import { Controller, UseGuards } from '@nestjs/common';
import { DocumentExistsGuard } from './documents.guards';
import { DocumentMembershipGuard } from './documents.guards';

@UseGuards(DocumentExistsGuard, DocumentMembershipGuard)
@Controller('documents')
export class DocumentsController {}
