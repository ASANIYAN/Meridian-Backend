import { Module } from '@nestjs/common';
import { ShareLinksService } from './share_links.service';
import { ShareLinksController } from './share_links.controller';

@Module({
  providers: [ShareLinksService],
  controllers: [ShareLinksController],
})
export class ShareLinksModule {}
