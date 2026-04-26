import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Controller()
export class AppController {
  constructor(private readonly configService: ConfigService) {}

  @Get()
  getRoot() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'Meridian-Backend',
      port: this.configService.getOrThrow<number>('PORT'),
    };
  }
}
