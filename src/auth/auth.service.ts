import * as schema from '../database/schema';
import { randomBytes } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DATABASE_CONNECTION } from '../database/database-connection';
import {
  RegisterDto,
  ResendVerificationEmailDto,
  VerifyEmailDto,
} from './dto/auth.dto';
import {
  hashPassword,
  hashValue,
  verifyValue,
} from '../common/security/password';
import { eq } from 'drizzle-orm';
import { JwtService } from '@nestjs/jwt';
import { MailService } from '../mail/mail.service';

type SignupResult = {
  user: typeof schema.users.$inferSelect;
  verificationEmailSent: boolean;
};

type ResendVerificationEmailResult = {
  user: typeof schema.users.$inferSelect;
  verificationEmailSent: boolean;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly database: NodePgDatabase<typeof schema>,
    private jwtService: JwtService,
    private mailService: MailService,
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

      const verificationEmailSent = await this.sendVerificationEmail(
        email,
        verificationToken.rawToken,
      );

      return {
        user,
        verificationEmailSent,
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
      throw new NotFoundException('Account not found');
    }

    if (user.verifiedAt) {
      throw new ConflictException('Account already verified');
    }

    try {
      const verificationToken = await this.generateVerificationToken();
      const [updatedUser] = await this.database
        .update(schema.users)
        .set({
          updatedAt: new Date(),
          verificationTokenHash: verificationToken.tokenHash,
          verificationTokenExpiresAt: verificationToken.expiresAt,
        })
        .where(eq(schema.users.email, email))
        .returning();

      this.logger.log(`Updated verification token and hash for ${email}`);
      const verificationEmailSent = await this.sendVerificationEmail(
        email,
        verificationToken.rawToken,
      );

      return {
        user: updatedUser,
        verificationEmailSent,
      };
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ConflictException
      ) {
        throw error;
      }

      const msg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Failed to resend verification email for ${email}: ${msg}`,
      );
      throw new InternalServerErrorException(
        'Failed to resend verification email',
      );
    }
  }
}
