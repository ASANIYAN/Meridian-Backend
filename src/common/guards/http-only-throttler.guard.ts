import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerLimitDetail } from '@nestjs/throttler';
import { decode } from 'jsonwebtoken';
import type { JwtPayload } from '../../auth/strategies/jwt.strategy';

@Injectable()
export class HttpOnlyThrottlerGuard extends ThrottlerGuard {
  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') {
      return true;
    }
    return super.shouldSkip(context);
  }

  // Authenticated requests are keyed by user_id so office networks sharing an
  // IP don't interfere with each other. Unauthenticated requests fall back to IP.
  protected getTracker(req: Record<string, unknown>): Promise<string> {
    const headers = req.headers as Record<string, string | undefined>;
    const authHeader = headers?.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const payload = decode(authHeader.slice(7)) as JwtPayload | null;
        if (payload?.userId) {
          return Promise.resolve(`user:${payload.userId}`);
        }
      } catch {
        // fall through to IP
      }
    }
    return Promise.resolve(req.ip as string);
  }

  // For the ai-chat throttler, append the document ID so the counter is
  // per-user-per-document rather than per-user across all documents.
  protected generateKey(
    context: ExecutionContext,
    suffix: string,
    throttlerName: string,
  ): string {
    if (throttlerName === 'ai-chat') {
      const req = context
        .switchToHttp()
        .getRequest<{ params?: { id?: string } }>();
      const docId = req.params?.id ?? '';
      return super.generateKey(
        context,
        `${suffix}:doc:${docId}`,
        throttlerName,
      );
    }
    return super.generateKey(context, suffix, throttlerName);
  }

  protected async throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const res = context
      .switchToHttp()
      .getResponse<{ header(name: string, value: unknown): void }>();
    res.header('Retry-After', Math.ceil(detail.timeToExpire / 1000));
    await super.throwThrottlingException(context, detail);
  }
}
