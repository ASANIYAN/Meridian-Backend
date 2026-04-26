import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const logger = new Logger('Boot');
  const app = await NestFactory.create(AppModule);

  await app.listen(process.env.PORT ?? 3000);

  logger.log('App Boot Successful');
  logger.log(`Listening on ${await app.getUrl()}`);
}
void bootstrap();
