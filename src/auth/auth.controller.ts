import { Body, Controller, Post, Req } from '@nestjs/common';
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
import { Throttle } from '@nestjs/throttler';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ApiSuccessResponseEnvelope } from '../common/swagger/decorators/api-success-response-envelope.decorator';
import { errorResponseSchema } from '../common/swagger/utils/error-response-schema';
import {
  AcceptedResponseDataDto,
  JwtTokenResponseDataDto,
  LogoutResponseDataDto,
  PasswordResetResponseDataDto,
  SignupResponseDataDto,
  VerifyEmailResponseDataDto,
} from './dto/auth-response.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle({ auth: { limit: 10, ttl: 3_600_000 } })
  @Post('signup')
  @ApiOperation({
    summary: 'Create an account',
    description:
      'Registers a new Meridian user account and queues an email verification message.',
  })
  @ApiSuccessResponseEnvelope({
    dataDto: SignupResponseDataDto,
    description: 'Account created successfully.',
    messageExample:
      'Account created successfully. You should receive a verification email shortly.',
  })
  @ApiBadRequestResponse({
    description: 'Validation failed for the request body.',
    schema: errorResponseSchema(
      400,
      ['Please provide a valid email address'],
      'Bad Request',
    ),
  })
  @ApiConflictResponse({
    description: 'An account already exists for the provided email.',
    schema: errorResponseSchema(
      409,
      'Account already exists, please login',
      'Conflict',
    ),
  })
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
      },
    );
  }

  @Public()
  @Post('verify-email')
  @ApiOperation({
    summary: 'Verify email address',
    description:
      'Validates an email verification token and marks the account as verified.',
  })
  @ApiBody({ type: VerifyEmailDto })
  @ApiSuccessResponseEnvelope({
    dataDto: VerifyEmailResponseDataDto,
    description: 'Email verification completed successfully.',
    messageExample: 'Email address verified successfully.',
  })
  @ApiBadRequestResponse({
    description: 'Verification token is invalid or expired.',
    schema: errorResponseSchema(
      400,
      'Verification token is invalid or expired',
      'Bad Request',
    ),
  })
  @ApiUnauthorizedResponse({
    description: 'Unused for this route.',
    schema: errorResponseSchema(401, 'Authentication required', 'Unauthorized'),
  })
  async verifyEmail(@Body() data: VerifyEmailDto): Promise<
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
  @Throttle({ auth: {} })
  @Post('resend-verification-email')
  @ApiOperation({
    summary: 'Resend verification email',
    description:
      'Queues a new verification email for an existing unverified account. This endpoint is rate-limited.',
  })
  @ApiSuccessResponseEnvelope({
    dataDto: AcceptedResponseDataDto,
    description: 'Verification resend request accepted.',
    messageExample:
      'If an account with that email exists and is not yet verified, you should receive a verification email shortly.',
  })
  @ApiBadRequestResponse({
    description: 'Validation failed for the request body.',
    schema: errorResponseSchema(
      400,
      ['Please provide a valid email address'],
      'Bad Request',
    ),
  })
  @ApiTooManyRequestsResponse({
    description: 'Auth rate limit exceeded.',
    schema: errorResponseSchema(
      429,
      'ThrottlerException: Too Many Requests',
      'Too Many Requests',
    ),
  })
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
  @Throttle({ auth: {} })
  @Post('login')
  @ApiOperation({
    summary: 'Log in',
    description:
      'Authenticates a verified user and returns a JWT access token. This endpoint is rate-limited.',
  })
  @ApiSuccessResponseEnvelope({
    dataDto: JwtTokenResponseDataDto,
    description: 'JWT issued successfully.',
    messageExample: 'Login successful.',
  })
  @ApiBadRequestResponse({
    description: 'Validation failed for the request body.',
    schema: errorResponseSchema(
      400,
      ['Please provide a valid email address'],
      'Bad Request',
    ),
  })
  @ApiUnauthorizedResponse({
    description: 'Credentials are invalid.',
    schema: errorResponseSchema(
      401,
      'Invalid email or password',
      'Unauthorized',
    ),
  })
  @ApiForbiddenResponse({
    description: 'The account exists but is not yet verified.',
    schema: errorResponseSchema(
      403,
      'Account not verified. Check your inbox.',
      'Forbidden',
    ),
  })
  @ApiTooManyRequestsResponse({
    description: 'Auth rate limit exceeded.',
    schema: errorResponseSchema(
      429,
      'ThrottlerException: Too Many Requests',
      'Too Many Requests',
    ),
  })
  async login(
    @Body() data: LoginDto,
  ): Promise<SuccessResponse<Awaited<ReturnType<AuthService['login']>>>> {
    const result = await this.authService.login(data);

    return buildSuccessResponse('Login successful.', result);
  }

  @Public()
  @Throttle({ auth: { limit: 3, ttl: 3_600_000 } })
  @Post('forgot-password')
  @ApiOperation({
    summary: 'Start password reset',
    description:
      'Accepts a password reset request and only emails verified accounts. Always returns a generic success response. This endpoint is rate-limited.',
  })
  @ApiSuccessResponseEnvelope({
    dataDto: AcceptedResponseDataDto,
    description: 'Password reset request accepted.',
    messageExample:
      'If a verified account exists for that email, password reset instructions have been sent.',
  })
  @ApiBadRequestResponse({
    description: 'Validation failed for the request body.',
    schema: errorResponseSchema(
      400,
      ['Please provide a valid email address'],
      'Bad Request',
    ),
  })
  @ApiTooManyRequestsResponse({
    description: 'Auth rate limit exceeded.',
    schema: errorResponseSchema(
      429,
      'ThrottlerException: Too Many Requests',
      'Too Many Requests',
    ),
  })
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
  @Throttle({ auth: {} })
  @Post('reset-password')
  @ApiOperation({
    summary: 'Reset password',
    description:
      'Resets the password for a verified account using a valid password reset token. This endpoint is rate-limited.',
  })
  @ApiSuccessResponseEnvelope({
    dataDto: PasswordResetResponseDataDto,
    description: 'Password reset completed successfully.',
    messageExample: 'Password reset successful.',
  })
  @ApiBadRequestResponse({
    description: 'Validation failed or reset token is invalid/expired.',
    schema: errorResponseSchema(
      400,
      'Password reset token is invalid or expired',
      'Bad Request',
    ),
  })
  @ApiTooManyRequestsResponse({
    description: 'Auth rate limit exceeded.',
    schema: errorResponseSchema(
      429,
      'ThrottlerException: Too Many Requests',
      'Too Many Requests',
    ),
  })
  async resetPassword(
    @Body() data: ResetPasswordDto,
  ): Promise<
    SuccessResponse<Awaited<ReturnType<AuthService['resetPassword']>>>
  > {
    const result = await this.authService.resetPassword(data);

    return buildSuccessResponse('Password reset successful.', result);
  }

  @Post('logout')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Log out',
    description:
      'Blacklists the current JWT so it can no longer be used on protected routes.',
  })
  @ApiSuccessResponseEnvelope({
    dataDto: LogoutResponseDataDto,
    description: 'Logout completed successfully.',
    messageExample: 'Logout successful.',
  })
  @ApiUnauthorizedResponse({
    description: 'Missing, expired, or revoked JWT.',
    schema: errorResponseSchema(401, 'Authentication required', 'Unauthorized'),
  })
  async logout(
    @Req() req: Request & { user: AuthenticatedUser },
  ): Promise<SuccessResponse<Awaited<ReturnType<AuthService['logout']>>>> {
    const result = await this.authService.logout(req.user);

    return buildSuccessResponse('Logout successful.', result);
  }

  @Post('refresh')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Refresh access token',
    description:
      'Rotates the current valid JWT, blacklists the old token, and returns a fresh access token with a new jti.',
  })
  @ApiSuccessResponseEnvelope({
    dataDto: JwtTokenResponseDataDto,
    description: 'JWT refreshed successfully.',
    messageExample: 'Token refreshed successfully.',
  })
  @ApiUnauthorizedResponse({
    description: 'Missing, expired, or revoked JWT.',
    schema: errorResponseSchema(401, 'Authentication required', 'Unauthorized'),
  })
  async refresh(
    @Req() req: Request & { user: AuthenticatedUser },
  ): Promise<SuccessResponse<Awaited<ReturnType<AuthService['issueNewJwt']>>>> {
    const result = await this.authService.issueNewJwt(req.user);

    return buildSuccessResponse('Token refreshed successfully.', result);
  }
}
