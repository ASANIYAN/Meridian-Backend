export class MockMailService {
  private readonly tokens = new Map<string, string>();

  sendVerificationEmail(email: string, token: string): void {
    this.tokens.set(`verify:${email}`, token);
  }

  sendPasswordResetEmail(email: string, token: string): void {
    this.tokens.set(`reset:${email}`, token);
  }

  getVerificationToken(email: string): string | undefined {
    return this.tokens.get(`verify:${email}`);
  }

  getResetToken(email: string): string | undefined {
    return this.tokens.get(`reset:${email}`);
  }

  clear(): void {
    this.tokens.clear();
  }
}
