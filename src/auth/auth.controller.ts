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
      result.verificationEmailSent
        ? 'Account created successfully. Verification email sent.'
        : 'Account created successfully, but the verification email could not be sent.',
      {
        user: result.user,
        verificationEmailSent: result.verificationEmailSent,
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
        ? 'Email address is already verified.'
        : 'Email address verified successfully.',
      result,
    );
  }

  @Post('resend-verification-email')
  async resendVerificationEmail(
    @Body() data: ResendVerificationEmailDto,
  ): Promise<
    SuccessResponse<{
      user: Awaited<ReturnType<AuthService['resendVerificationEmail']>>['user'];
      verificationEmailSent: Awaited<
        ReturnType<AuthService['resendVerificationEmail']>
      >['verificationEmailSent'];
    }>
  > {
    const result = await this.authService.resendVerificationEmail(data);

    return buildSuccessResponse(
      result.verificationEmailSent
        ? 'Verification email sent successfully.'
        : 'Verification token refreshed, but the verification email could not be sent.',
      result,
    );
  }
}
