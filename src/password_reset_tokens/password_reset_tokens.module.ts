import { Module } from '@nestjs/common';
import { PasswordResetTokensService } from './password_reset_tokens.service';
import { PasswordResetTokensController } from './password_reset_tokens.controller';

@Module({
  providers: [PasswordResetTokensService],
  controllers: [PasswordResetTokensController],
})
export class PasswordResetTokensModule {}
