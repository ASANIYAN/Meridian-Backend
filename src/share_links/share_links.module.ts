import { Module } from '@nestjs/common';
import { ShareLinksService } from './share_links.service';
import { ShareLinksController } from './share_links.controller';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule],
  providers: [ShareLinksService],
  controllers: [ShareLinksController],
  exports: [ShareLinksService],
})
export class ShareLinksModule {}
