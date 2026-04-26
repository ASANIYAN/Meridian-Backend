import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get()
  getRoot() {
    const port = process.env.port ?? 3000;
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'Meridian-Backend',
      port,
    };
  }
}
