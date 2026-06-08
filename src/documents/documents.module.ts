import { MiddlewareConsumer, Module } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
import {
  DocumentExistsGuard,
  DocumentMembershipGuard,
} from './documents.middleware';

@Module({
  providers: [DocumentsService],
  controllers: [DocumentsController],
})
export class DocumentsModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(DocumentExistsGuard, DocumentMembershipGuard)
      .forRoutes('documents/*path');
  }
}
