import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { AuthenticatedUser, AuthService } from './auth.service';
import {
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  ResendVerificationEmailDto,
  VerifyEmailDto,
} from './dto/auth.dto';
import {
  buildSuccessResponse,
  type SuccessResponse,
} from '../common/responses/success-response';
import { Public } from './decorators/public.decorator';
import { Request } from 'express';
import { AuthRateLimit } from '../common/rate-limit/decorators/auth-rate-limit.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
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

  @Public()
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

  @Public()
  @AuthRateLimit()
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

  @Public()
  @AuthRateLimit()
  @Post('login')
  async login(
    @Body() data: LoginDto,
  ): Promise<SuccessResponse<Awaited<ReturnType<AuthService['login']>>>> {
    const result = await this.authService.login(data);

    return buildSuccessResponse('Login successful.', result);
  }

  @Public()
  @AuthRateLimit()
  @Post('forgot-password')
  async forgotPassword(
    @Body() data: ForgotPasswordDto,
  ): Promise<
    SuccessResponse<Awaited<ReturnType<AuthService['forgotPassword']>>>
  > {
    const result = await this.authService.forgotPassword(data);

    return buildSuccessResponse(
      'If a verified account exists for that email, password reset instructions have been sent.',
      result,
    );
  }

  @Public()
  @AuthRateLimit()
  @Post('reset-password')
  async resetPassword(
    @Body() data: ResetPasswordDto,
  ): Promise<
    SuccessResponse<Awaited<ReturnType<AuthService['resetPassword']>>>
  > {
    const result = await this.authService.resetPassword(data);

    return buildSuccessResponse('Password reset successful.', result);
  }

  @Post('logout')
  async logout(
    @Req() req: Request & { user: AuthenticatedUser },
  ): Promise<SuccessResponse<Awaited<ReturnType<AuthService['logout']>>>> {
    const result = await this.authService.logout(req.user);

    return buildSuccessResponse('Logout successful.', result);
  }

  @Post('refresh')
  async refresh(
    @Req() req: Request & { user: AuthenticatedUser },
  ): Promise<SuccessResponse<Awaited<ReturnType<AuthService['issueNewJwt']>>>> {
    const result = await this.authService.issueNewJwt(req.user);

    return buildSuccessResponse('Token refreshed successfully.', result);
  }
}
