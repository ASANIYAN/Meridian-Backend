import { readFile } from 'fs/promises';
import { join } from 'path';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailerService } from '@nestjs-modules/mailer';

const TEMPLATES_DIR = join(__dirname, 'templates');

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    private readonly mailer: MailerService,
    private readonly configService: ConfigService,
  ) {}

  private buildUrl(path: string, queryParams: Record<string, string> = {}) {
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

  private async renderTemplate(
    templateName: string,
    variables: Record<string, string>,
  ) {
    const templatePath = join(TEMPLATES_DIR, templateName);
    const template = await readFile(templatePath, 'utf-8');

    return Object.entries(variables).reduce(
      (html, [key, value]) =>
        html.replaceAll(new RegExp(`{{\\s*${key}\\s*}}`, 'g'), value),
      template,
    );
  }

  async sendVerificationEmail(to: string, token: string, expiryHours: number) {
    const verificationUrl = this.buildUrl('/verify-email', {
      email: to,
      token,
    });
    const subject = 'Verify your email for Meridian';
    const text = `Verify your Meridian account by visiting: ${verificationUrl}`;
    const html = await this.renderTemplate('email-verification.html', {
      recipientEmail: to,
      verifyLink: verificationUrl,
      expiryHours: String(expiryHours),
    });

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

  async sendPasswordResetEmail(to: string, token: string, expiryHours: number) {
    const resetUrl = this.buildUrl('/reset-password', {
      email: to,
      token,
    });
    const subject = 'Reset your Meridian password';
    const text = `Reset your Meridian password by visiting: ${resetUrl}`;
    const html = await this.renderTemplate('password-reset.html', {
      recipientEmail: to,
      resetLink: resetUrl,
      expiryHours: String(expiryHours),
    });

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

  async sendDocumentInvitationEmail(
    to: string,
    inviterName: string,
    documentTitle: string,
    role: string,
    documentId: string,
  ) {
    const documentUrl = this.buildUrl(`/documents/${documentId}`);
    const subject = `${inviterName} invited you to collaborate on "${documentTitle}"`;
    const text = `${inviterName} invited you to collaborate on "${documentTitle}" as a ${role}. Open it here: ${documentUrl}`;
    const html = await this.renderTemplate('document-invitation.html', {
      recipientEmail: to,
      inviterName,
      documentTitle,
      role,
      acceptInviteLink: documentUrl,
    });

    try {
      await this.mailer.sendMail({
        to,
        subject,
        html,
        text,
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to send document invitation email: ${msg}`);
      throw error;
    }
  }
}
