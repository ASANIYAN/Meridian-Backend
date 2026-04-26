import { Test, TestingModule } from '@nestjs/testing';
import { PasswordResetTokensController } from './password_reset_tokens.controller';

describe('PasswordResetTokensController', () => {
  let controller: PasswordResetTokensController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PasswordResetTokensController],
    }).compile();

    controller = module.get<PasswordResetTokensController>(PasswordResetTokensController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
