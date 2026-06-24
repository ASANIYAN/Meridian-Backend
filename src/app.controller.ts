import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from './auth/decorators/public.decorator';
import { RootResponseDto } from './app/dto/root-response.dto';
import { SkipThrottle } from '@nestjs/throttler';

@ApiTags('System')
@Controller()
export class AppController {
  constructor(private readonly configService: ConfigService) {}

  @Public()
  @SkipThrottle()
  @Get()
  @ApiOperation({
    summary: 'Get service status',
    description: 'Returns a lightweight status payload for the Meridian API.',
  })
  @ApiOkResponse({
    description: 'Service status returned successfully.',
    type: RootResponseDto,
  })
  getRoot() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'Meridian-Backend',
      port: this.configService.getOrThrow<number>('PORT'),
    };
  }

  @Public()
  @SkipThrottle()
  @Get('health')
  @ApiOperation({
    summary: 'Health check',
    description: 'Liveness probe — never rate limited.',
  })
  @ApiOkResponse({ description: 'Service is healthy.' })
  getHealth() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
