import { Test, TestingModule } from '@nestjs/testing';
import { PasswordResetTokensService } from './password_reset_tokens.service';

describe('PasswordResetTokensService', () => {
  let service: PasswordResetTokensService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PasswordResetTokensService],
    }).compile();

    service = module.get<PasswordResetTokensService>(
      PasswordResetTokensService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
