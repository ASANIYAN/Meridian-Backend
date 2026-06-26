import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PasswordResetTokensService } from './password_reset_tokens.service';

@Module({
  imports: [DatabaseModule],
  providers: [PasswordResetTokensService],
  exports: [PasswordResetTokensService],
})
export class PasswordResetTokensModule {}
