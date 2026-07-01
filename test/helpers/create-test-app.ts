import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from '../../src/app.module';
import { MailService } from '../../src/mail/mail.service';
import { MockMailService } from './mock-mail.service';

export async function createTestApp(): Promise<{
  app: INestApplication;
  mockMail: MockMailService;
}> {
  const mockMail = new MockMailService();

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(MailService)
    .useValue(mockMail)
    .compile();

  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('v1');
  app.useGlobalPipes(new ValidationPipe({ transform: true }));
  app.useWebSocketAdapter(new WsAdapter(app));

  const port = app.get(ConfigService).getOrThrow<number>('PORT');
  await app.listen(port);

  return { app, mockMail };
}
