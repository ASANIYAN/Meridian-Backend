import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { AuthService } from './auth.service';
import {
  RegisterDto,
  ResendVerificationEmailDto,
  VerifyEmailDto,
} from './dto/auth.dto';
import {
  buildSuccessResponse,
  type SuccessResponse,
} from '../common/responses/success-response';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('signup')
  async signup(@Body() data: RegisterDto): Promise<
    SuccessResponse<{
      user: Awaited<ReturnType<AuthService['signup']>>['user'];
    }>
  > {
    const result = await this.authService.signup(data);

    return buildSuccessResponse(
      'Account created successfully. You should receive a verification email shortly.',
      {
        user: result.user,
        verificationEmailQueued: result.verificationEmailQueued,
      },
    );
  }

  @Get('verify-email')
  async verifyEmail(@Query() data: VerifyEmailDto): Promise<
    SuccessResponse<{
      user: Awaited<ReturnType<AuthService['verifyEmail']>>['user'];
      alreadyVerified: Awaited<
        ReturnType<AuthService['verifyEmail']>
      >['alreadyVerified'];
    }>
  > {
    const result = await this.authService.verifyEmail(data);

    return buildSuccessResponse(
      result.alreadyVerified
        ? 'Email address is already verified. You can proceed to login.'
        : 'Email address verified successfully.',
      result,
    );
  }

  @Post('resend-verification-email')
  async resendVerificationEmail(
    @Body() data: ResendVerificationEmailDto,
  ): Promise<
    SuccessResponse<Awaited<ReturnType<AuthService['resendVerificationEmail']>>>
  > {
    const result = await this.authService.resendVerificationEmail(data);

    return buildSuccessResponse(
      'If an account with that email exists and is not yet verified, you should receive a verification email shortly.',
      result,
    );
  }
}
