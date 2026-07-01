import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RedisService } from '../../redis/redis.service';

type MockFn = jest.Mock<(...args: any[]) => any>;

function createMockContext(user?: object): ExecutionContext {
  const request = { user };
  return {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: jest.fn().mockReturnValue({
      getRequest: jest.fn().mockReturnValue(request),
    }),
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let reflector: { getAllAndOverride: MockFn };
  let redisService: { isTokenBlacklisted: MockFn };
  let superCanActivate: MockFn;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    redisService = { isTokenBlacklisted: jest.fn() };
    guard = new JwtAuthGuard(
      reflector as unknown as Reflector,
      redisService as unknown as RedisService,
    );

    // Intercept the Passport AuthGuard base class canActivate so no real JWT
    // verification or passport.authenticate call is made during unit tests.
    const parent = Object.getPrototypeOf(JwtAuthGuard.prototype) as {
      canActivate: (ctx: ExecutionContext) => Promise<boolean>;
    };
    superCanActivate = jest
      .spyOn(parent, 'canActivate')
      .mockResolvedValue(true) as unknown as jest.Mock;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── handleRequest ──────────────────────────────────────────────────────────
  // handleRequest is the synchronous hook passport calls after token verification.
  // Testing it directly avoids any need to invoke real passport machinery.

  describe('handleRequest', () => {
    it('returns the user when credentials are valid', () => {
      const user = {
        userId: 'user-1',
        email: 'user@example.com',
        jti: 'jti-1',
      };

      expect(guard.handleRequest(null, user, undefined)).toBe(user);
    });

    it('re-throws the error when passport signals an error', () => {
      const err = new UnauthorizedException('jwt expired');

      expect(() => guard.handleRequest(err, null, undefined)).toThrow(err);
    });

    it('throws UnauthorizedException with the info message when the token is expired or malformed', () => {
      const info = new Error('jwt expired');

      expect(() => guard.handleRequest(null, null, info)).toThrow(
        new UnauthorizedException('jwt expired'),
      );
    });

    it('throws UnauthorizedException with a fallback message when there is no user and no info', () => {
      expect(() => guard.handleRequest(null, false, undefined)).toThrow(
        new UnauthorizedException('Authentication required'),
      );
    });
  });

  // ── canActivate ────────────────────────────────────────────────────────────

  describe('canActivate', () => {
    it('returns true immediately for routes decorated with @Public() without invoking passport', async () => {
      reflector.getAllAndOverride.mockReturnValue(true);
      const context = createMockContext();

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(superCanActivate).not.toHaveBeenCalled();
    });

    it('returns true when the JWT is valid and the jti is not blacklisted', async () => {
      const user = {
        userId: 'user-1',
        email: 'user@example.com',
        jti: 'jti-valid',
      };
      const context = createMockContext(user);
      redisService.isTokenBlacklisted.mockResolvedValue(false);

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(redisService.isTokenBlacklisted).toHaveBeenCalledWith('jti-valid');
    });

    it('throws UnauthorizedException when the jti is on the Redis blacklist', async () => {
      const user = {
        userId: 'user-1',
        email: 'user@example.com',
        jti: 'jti-revoked',
      };
      const context = createMockContext(user);
      redisService.isTokenBlacklisted.mockResolvedValue(true);

      await expect(guard.canActivate(context)).rejects.toThrow(
        new UnauthorizedException('Authentication token has been revoked'),
      );
    });

    it('throws UnauthorizedException when passport attaches no user to the request', async () => {
      const context = createMockContext(undefined);

      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException when the user object has no jti', async () => {
      const context = createMockContext({
        userId: 'user-1',
        email: 'user@example.com',
      });

      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
