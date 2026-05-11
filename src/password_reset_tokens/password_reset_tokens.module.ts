import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PasswordResetTokensService } from './password_reset_tokens.service';
import { PasswordResetTokensController } from './password_reset_tokens.controller';

@Module({
  imports: [DatabaseModule],
  providers: [PasswordResetTokensService],
  controllers: [PasswordResetTokensController],
  exports: [PasswordResetTokensService],
})
export class PasswordResetTokensModule {}
