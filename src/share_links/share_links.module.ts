import { Module } from '@nestjs/common';
import { ShareLinksService } from './share_links.service';
import { ShareLinksController } from './share_links.controller';
import { DatabaseModule } from '../database/database.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [DatabaseModule, ConfigModule],
  providers: [ShareLinksService],
  controllers: [ShareLinksController],
  exports: [ShareLinksService],
})
export class ShareLinksModule {}
