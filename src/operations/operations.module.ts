import { Module } from '@nestjs/common';
import { OperationsService } from './operations.service';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule],
  providers: [OperationsService],
  exports: [OperationsService],
})
export class OperationsModule {}
