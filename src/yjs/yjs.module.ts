import { Module } from '@nestjs/common';
import { YjsService } from './yjs.service';

@Module({
  providers: [YjsService],
  controllers: [],
  exports: [YjsService],
})
export class YjsModule {}
