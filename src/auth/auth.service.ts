import * as schema from '../database/schema';
import { randomBytes, randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DATABASE_CONNECTION } from '../database/database-connection';
import {
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  ResendVerificationEmailDto,
  VerifyEmailDto,
} from './dto/auth.dto';
import {
  hashPassword,
  hashValue,
  verifyPassword,
  verifyValue,
} from '../common/security/password';
import { and, eq, gt, isNull, ne } from 'drizzle-orm';
import { JwtService } from '@nestjs/jwt';
import { MailService } from '../mail/mail.service';
import { RedisService } from '../redis/redis.service';
import { PasswordResetTokensService } from '../password_reset_tokens/password_reset_tokens.service';

type SignupResult = {
  user: typeof schema.users.$inferSelect;
  verificationEmailQueued: true;
};

type ResendVerificationEmailResult = {
  accepted: true;
};

type LoginResult = {
  token: string;
};

type ForgotPasswordResult = {
  accepted: true;
};

type ResetPasswordResult = {
  passwordReset: true;
};

export type AuthenticatedUser = {
  userId: string;
  email: string;
  jti: string;
  iat?: number;
  exp?: number;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly database: NodePgDatabase<typeof schema>,
    private jwtService: JwtService,
    private mailService: MailService,
    private redisService: RedisService,
    private passwordResetTokensService: PasswordResetTokensService,
    private readonly configService: ConfigService,
  ) {}

  private async getUserByEmail(email: string) {
    const result = await this.database
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email));

    return result[0];
  }

  private async generateVerificationToken() {
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = await hashValue(rawToken);
    const expiryHours = this.configService.getOrThrow<number>(
      'EMAIL_VERIFICATION_TOKEN_EXPIRY_HOURS',
    );
    const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000);

    return {
      rawToken,
      tokenHash,
      expiresAt,
    };
  }

  private async sendVerificationEmail(email: string, token: string) {
    try {
      await this.mailService.sendVerificationEmail(email, token);
      this.logger.log(`Successfully sent verification email to ${email}`);
      return true;
    } catch (error) {
      this.logger.error(
        `Unable to send verification email with token to ${email}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return false;
    }
  }

  private queueVerificationEmail(email: string, token: string) {
    void this.sendVerificationEmail(email, token);
  }

  private async generatePasswordResetToken() {
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = await hashValue(rawToken);
    const expiryHours = this.configService.getOrThrow<number>(
      'PASSWORD_RESET_TOKEN_EXPIRY_HOURS',
    );
    const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000);

    return {
      rawToken,
      tokenHash,
      expiresAt,
    };
  }

  private async sendPasswordResetEmail(email: string, token: string) {
    try {
      await this.mailService.sendPasswordResetEmail(email, token);
      this.logger.log(`Successfully sent password reset email to ${email}`);
      return true;
    } catch (error) {
      this.logger.error(
        `Unable to send password reset email to ${email}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return false;
    }
  }

  private queuePasswordResetEmail(email: string, token: string) {
    void this.sendPasswordResetEmail(email, token);
  }

  private isUniqueEmailViolation(error: unknown) {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === '23505'
    );
  }

  async signup(data: RegisterDto): Promise<SignupResult> {
    const { email, firstName, lastName, password } = data;

    const existingUser = await this.getUserByEmail(email);
    if (existingUser) {
      throw new ConflictException('Account already exists, please login');
    }

    try {
      const hashedPassword = await hashPassword(password);
      const verificationToken = await this.generateVerificationToken();

      const [user] = await this.database
        .insert(schema.users)
        .values({
          firstName,
          lastName,
          email,
          passwordHash: hashedPassword,
          verificationTokenHash: verificationToken.tokenHash,
          verificationTokenExpiresAt: verificationToken.expiresAt,
        })
        .returning();

      this.logger.log(`Created user account for ${email}`);

      this.queueVerificationEmail(email, verificationToken.rawToken);

      return {
        user,
        verificationEmailQueued: true,
      };
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }

      if (this.isUniqueEmailViolation(error)) {
        throw new ConflictException('Account already exists, please login');
      }

      const msg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Registration failed: ${msg}`);
      throw new InternalServerErrorException('Registration failed');
    }
  }

  async verifyEmail(data: VerifyEmailDto) {
    const { email, token } = data;

    const user = await this.getUserByEmail(email);
    if (!user) {
      throw new NotFoundException('Account not found');
    }

    if (user.verifiedAt) {
      return {
        user,
        alreadyVerified: true,
      };
    }

    if (
      !user.verificationTokenHash ||
      !user.verificationTokenExpiresAt ||
      user.verificationTokenExpiresAt.getTime() < Date.now()
    ) {
      throw new BadRequestException('Verification token is invalid or expired');
    }

    const isValidToken = await verifyValue(token, user.verificationTokenHash);
    if (!isValidToken) {
      throw new BadRequestException('Verification token is invalid or expired');
    }

    try {
      const [verifiedUser] = await this.database
        .update(schema.users)
        .set({
          verifiedAt: new Date(),
          verificationTokenHash: null,
          verificationTokenExpiresAt: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.users.id, user.id))
        .returning();

      this.logger.log(`Verified email address for ${email}`);

      return {
        user: verifiedUser,
        alreadyVerified: false,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Email verification failed for ${email}: ${msg}`);
      throw new InternalServerErrorException('Email verification failed');
    }
  }

  async resendVerificationEmail(
    data: ResendVerificationEmailDto,
  ): Promise<ResendVerificationEmailResult> {
    const { email } = data;
    const user = await this.getUserByEmail(email);
    if (!user) {
      this.logger.log(
        `Ignoring verification resend request for non-existent account: ${email}`,
      );
      return { accepted: true };
    }

    if (user.verifiedAt) {
      this.logger.log(
        `Ignoring verification resend request for verified account: ${email}`,
      );
      return { accepted: true };
    }

    try {
      const verificationToken = await this.generateVerificationToken();
      await this.database
        .update(schema.users)
        .set({
          updatedAt: new Date(),
          verificationTokenHash: verificationToken.tokenHash,
          verificationTokenExpiresAt: verificationToken.expiresAt,
        })
        .where(eq(schema.users.email, email))
        .returning();

      this.logger.log(`Updated verification token and hash for ${email}`);
      this.queueVerificationEmail(email, verificationToken.rawToken);

      return { accepted: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Failed to resend verification email for ${email}: ${msg}`,
      );
      throw new InternalServerErrorException(
        'Failed to resend verification email',
      );
    }
  }

  async login(data: LoginDto): Promise<LoginResult> {
    const { email, password } = data;
    const existingUser = await this.getUserByEmail(email);

    if (!existingUser) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const isUserPass = await verifyPassword(
      password,
      existingUser.passwordHash,
    );
    if (!isUserPass) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!existingUser.verifiedAt) {
      const tokenIsStillValid =
        !!existingUser.verificationTokenExpiresAt &&
        existingUser.verificationTokenExpiresAt.getTime() > Date.now();

      if (tokenIsStillValid) {
        throw new ForbiddenException('Account not verified. Check your inbox.');
      }

      await this.resendVerificationEmail({ email });
      this.logger.log(`Resent verification email during login for ${email}`);
      throw new ForbiddenException(
        'Account not verified. A new verification link has been sent.',
      );
    }

    try {
      const payload = {
        userId: existingUser.id,
        email: existingUser.email,
        jti: randomUUID(),
      };

      return {
        token: await this.jwtService.signAsync(payload),
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to create login token for ${email}: ${msg}`);
      throw new InternalServerErrorException('Login failed');
    }
  }

  async forgotPassword(data: ForgotPasswordDto): Promise<ForgotPasswordResult> {
    const { email } = data;
    const user = await this.getUserByEmail(email);

    if (!user || !user.verifiedAt) {
      this.logger.log(
        `Ignoring password reset request for ineligible account: ${email}`,
      );
      return { accepted: true };
    }

    try {
      await this.passwordResetTokensService.revokeActiveTokensForUser(user.id);

      const resetToken = await this.generatePasswordResetToken();
      await this.passwordResetTokensService.createToken({
        userId: user.id,
        tokenHash: resetToken.tokenHash,
        expiresAt: resetToken.expiresAt,
      });

      this.queuePasswordResetEmail(email, resetToken.rawToken);
      return { accepted: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to create password reset for ${email}: ${msg}`);
      throw new InternalServerErrorException(
        'Failed to process password reset request',
      );
    }
  }

  async resetPassword(data: ResetPasswordDto): Promise<ResetPasswordResult> {
    const { email, token, newPassword } = data;
    const user = await this.getUserByEmail(email);

    if (!user) {
      throw new BadRequestException(
        'Password reset token is invalid or expired',
      );
    }

    const activeTokens =
      await this.passwordResetTokensService.getActiveTokensByUserId(user.id);

    let matchingToken: (typeof activeTokens)[number] | undefined;
    for (const resetToken of activeTokens) {
      const isMatch = await verifyValue(token, resetToken.tokenHash);
      if (isMatch) {
        matchingToken = resetToken;
        break;
      }
    }

    if (!matchingToken) {
      throw new BadRequestException(
        'Password reset token is invalid or expired',
      );
    }

    try {
      const hashedPassword = await hashPassword(newPassword);

      await this.database.transaction(async (tx) => {
        await tx
          .update(schema.users)
          .set({
            passwordHash: hashedPassword,
            updatedAt: new Date(),
          })
          .where(eq(schema.users.id, user.id));

        await tx
          .update(schema.passwordResetTokens)
          .set({
            consumedAt: new Date(),
          })
          .where(eq(schema.passwordResetTokens.id, matchingToken.id));

        await tx
          .update(schema.passwordResetTokens)
          .set({
            revokedAt: new Date(),
          })
          .where(
            and(
              eq(schema.passwordResetTokens.userId, user.id),
              ne(schema.passwordResetTokens.id, matchingToken.id),
              isNull(schema.passwordResetTokens.consumedAt),
              isNull(schema.passwordResetTokens.revokedAt),
              gt(schema.passwordResetTokens.expiresAt, new Date()),
            ),
          );
      });

      return { passwordReset: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to reset password for ${email}: ${msg}`);
      throw new InternalServerErrorException('Password reset failed');
    }
  }

  async logout(user: AuthenticatedUser) {
    if (!user.exp) {
      throw new UnauthorizedException('Invalid authentication token');
    }

    const nowInSeconds = Math.floor(Date.now() / 1000);
    const ttlSeconds = user.exp - nowInSeconds;

    await this.redisService.blacklistToken(user.jti, ttlSeconds);

    return { success: true };
  }
}
