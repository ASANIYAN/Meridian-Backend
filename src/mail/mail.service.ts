import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailerService } from '@nestjs-modules/mailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    private readonly mailer: MailerService,
    private readonly configService: ConfigService,
  ) {}

  private buildUrl(path: string, queryParams: Record<string, string>) {
    const appUrl = this.configService.getOrThrow<string>('APP_URL');
    const normalizedBaseUrl = appUrl.endsWith('/')
      ? appUrl.slice(0, -1)
      : appUrl;
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${normalizedBaseUrl}${normalizedPath}`);
    for (const [key, value] of Object.entries(queryParams)) {
      url.searchParams.set(key, value);
    }

    return url.toString();
  }

  async sendVerificationEmail(to: string, token: string) {
    const verificationUrl = this.buildUrl('/auth/verify-email', {
      email: to,
      token,
    });
    const subject = 'Verify your email';
    const text = `Verify your Meridian account by visiting: ${verificationUrl}`;
    const html = `
      <p>Welcome to Meridian.</p>
      <p>Please verify your email by clicking the link below:</p>
      <p><a href="${verificationUrl}">Verify your email</a></p>
      <p>If you did not create this account, you can ignore this email.</p>
    `;

    try {
      await this.mailer.sendMail({
        to,
        subject,
        html,
        text,
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to send verification email: ${msg}`);
      throw error;
    }
  }

  async sendPasswordResetEmail(to: string, token: string) {
    const resetUrl = this.buildUrl('/auth/reset-password', {
      email: to,
      token,
    });
    const subject = 'Reset your password';
    const text = `Reset your Meridian password by visiting: ${resetUrl}`;
    const html = `
      <p>We received a request to reset your Meridian password.</p>
      <p>Use the link below to continue:</p>
      <p><a href="${resetUrl}">Reset your password</a></p>
      <p>If you did not request this, you can ignore this email.</p>
    `;

    try {
      await this.mailer.sendMail({
        to,
        subject,
        html,
        text,
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to send password reset email: ${msg}`);
      throw error;
    }
  }
}
