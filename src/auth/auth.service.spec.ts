// jest.mock is hoisted above imports by ts-jest, so this factory runs before
// any module is loaded and replaces the real bcrypt-backed functions with
// controllable stubs throughout every test in this file.
jest.mock('../common/security/password', () => ({
  hashPassword: jest.fn(),
  hashValue: jest.fn(),
  verifyPassword: jest.fn(),
  verifyValue: jest.fn(),
}));

import * as passwordUtils from '../common/security/password';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { DATABASE_CONNECTION } from '../database/database-connection';
import { RedisService } from '../redis/redis.service';
import { MailService } from '../mail/mail.service';
import { UsersService } from '../users/users.service';
import { PasswordResetTokensService } from '../password_reset_tokens/password_reset_tokens.service';

type MockFn = jest.Mock<(...args: any[]) => any>;

describe('AuthService', () => {
  let service: AuthService;
  let database: ReturnType<typeof createDatabaseMock>;
  let redisService: ReturnType<typeof createRedisServiceMock>;
  let passwordResetTokensService: ReturnType<
    typeof createPasswordResetTokensServiceMock
  >;
  let configService: ReturnType<typeof createConfigServiceMock>;
  let usersService: ReturnType<typeof createUsersServiceMock>;
  let jwtService: { signAsync: MockFn };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(async () => {
    database = createDatabaseMock();
    redisService = createRedisServiceMock();
    passwordResetTokensService = createPasswordResetTokensServiceMock();
    configService = createConfigServiceMock();
    usersService = createUsersServiceMock();
    jwtService = { signAsync: jest.fn() };

    // Reset password utils to known defaults before each test so implementations
    // set in one test do not bleed into the next.
    jest
      .mocked(passwordUtils.hashPassword)
      .mockReset()
      .mockResolvedValue('hashed-password');
    jest
      .mocked(passwordUtils.hashValue)
      .mockReset()
      .mockResolvedValue('hashed-value');
    jest.mocked(passwordUtils.verifyPassword).mockReset();
    jest.mocked(passwordUtils.verifyValue).mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: DATABASE_CONNECTION,
          useValue: database,
        },
        {
          provide: JwtService,
          useValue: jwtService,
        },
        {
          provide: RedisService,
          useValue: redisService,
        },
        {
          provide: PasswordResetTokensService,
          useValue: passwordResetTokensService,
        },
        {
          provide: ConfigService,
          useValue: configService,
        },
        {
          provide: UsersService,
          useValue: usersService,
        },
        {
          provide: MailService,
          useValue: createMailServiceMock(),
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── signup ─────────────────────────────────────────────────────────────────

  describe('signup', () => {
    it('creates a user and strips sensitive fields from the returned object', async () => {
      usersService.getUserByEmail.mockResolvedValue(undefined);

      const fullUser = {
        id: 'user-1',
        firstName: 'Alice',
        lastName: 'Smith',
        email: 'alice@example.com',
        verifiedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        // These three must not appear on the result
        passwordHash: 'hashed-password',
        verificationTokenHash: 'hashed-value',
        verificationTokenExpiresAt: new Date(),
      };

      const returning = jest
        .fn<() => Promise<(typeof fullUser)[]>>()
        .mockResolvedValue([fullUser]);
      const values = jest.fn().mockReturnValue({ returning });
      database.insert.mockReturnValue({ values });

      const result = await service.signup({
        firstName: 'Alice',
        lastName: 'Smith',
        email: 'alice@example.com',
        password: 'Password123!',
      });

      expect(result.user.email).toBe('alice@example.com');
      expect(result.user).not.toHaveProperty('passwordHash');
      expect(result.user).not.toHaveProperty('verificationTokenHash');
      expect(result.user).not.toHaveProperty('verificationTokenExpiresAt');
    });

    it('throws ConflictException when the email is already registered', async () => {
      usersService.getUserByEmail.mockResolvedValue({
        id: 'user-1',
        email: 'alice@example.com',
        verifiedAt: new Date(),
      });

      await expect(
        service.signup({
          firstName: 'Alice',
          lastName: 'Smith',
          email: 'alice@example.com',
          password: 'Password123!',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws ConflictException when the database rejects with a unique constraint violation', async () => {
      usersService.getUserByEmail.mockResolvedValue(undefined);

      const returning = jest
        .fn<(...args: any[]) => any>()
        .mockRejectedValue({ code: '23505' });
      const values = jest.fn().mockReturnValue({ returning });
      database.insert.mockReturnValue({ values });

      await expect(
        service.signup({
          firstName: 'Alice',
          lastName: 'Smith',
          email: 'alice@example.com',
          password: 'Password123!',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  // ── login ──────────────────────────────────────────────────────────────────

  describe('login', () => {
    it('returns a signed JWT on valid credentials for a verified account', async () => {
      usersService.getUserCredentialsByEmail.mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
        passwordHash: 'stored-hash',
        verifiedAt: new Date(),
        verificationTokenExpiresAt: null,
      });
      jest.mocked(passwordUtils.verifyPassword).mockResolvedValue(true);
      jwtService.signAsync.mockResolvedValue('signed.jwt.token');

      const result = await service.login({
        email: 'user@example.com',
        password: 'correct-password',
      });

      expect(result).toEqual({ token: 'signed.jwt.token' });
      expect(jwtService.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          email: 'user@example.com',
          jti: expect.any(String),
        }),
      );
    });

    it('throws UnauthorizedException when no account exists for the email', async () => {
      usersService.getUserCredentialsByEmail.mockResolvedValue(undefined);

      await expect(
        service.login({ email: 'nobody@example.com', password: 'any' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('throws UnauthorizedException when the password is wrong', async () => {
      usersService.getUserCredentialsByEmail.mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
        passwordHash: 'stored-hash',
        verifiedAt: new Date(),
        verificationTokenExpiresAt: null,
      });
      jest.mocked(passwordUtils.verifyPassword).mockResolvedValue(false);

      await expect(
        service.login({ email: 'user@example.com', password: 'wrong' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('throws ForbiddenException when the account is unverified and the token is still valid', async () => {
      usersService.getUserCredentialsByEmail.mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
        passwordHash: 'stored-hash',
        verifiedAt: null,
        verificationTokenExpiresAt: new Date(Date.now() + 3_600_000),
      });
      jest.mocked(passwordUtils.verifyPassword).mockResolvedValue(true);

      await expect(
        service.login({ email: 'user@example.com', password: 'correct' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  // ── logout ─────────────────────────────────────────────────────────────────

  describe('logout', () => {
    it('throws UnauthorizedException when called without a token expiry', async () => {
      await expect(
        service.logout({
          userId: 'user-1',
          email: 'user@example.com',
          jti: 'jti-1',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('blacklists the jti with the token remaining TTL', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);

      await expect(
        service.logout({
          userId: 'user-1',
          email: 'user@example.com',
          jti: 'jti-1',
          exp: 1_700_000_300,
        }),
      ).resolves.toEqual({ success: true });

      expect(redisService.blacklistToken).toHaveBeenCalledWith('jti-1', 300);
    });
  });

  // ── forgotPassword ─────────────────────────────────────────────────────────

  describe('forgotPassword', () => {
    it('returns accepted without touching tokens when the account does not exist', async () => {
      usersService.getUserByEmail.mockResolvedValue(undefined);

      await expect(
        service.forgotPassword({ email: 'missing@example.com' }),
      ).resolves.toEqual({ accepted: true });

      expect(
        passwordResetTokensService.revokeActiveTokensForUser,
      ).not.toHaveBeenCalled();
      expect(passwordResetTokensService.createToken).not.toHaveBeenCalled();
    });

    it('returns accepted without touching tokens when the account is unverified', async () => {
      usersService.getUserByEmail.mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
        verifiedAt: null,
      });

      await expect(
        service.forgotPassword({ email: 'user@example.com' }),
      ).resolves.toEqual({ accepted: true });

      expect(
        passwordResetTokensService.revokeActiveTokensForUser,
      ).not.toHaveBeenCalled();
      expect(passwordResetTokensService.createToken).not.toHaveBeenCalled();
    });

    it('revokes old tokens and creates a new reset token for a verified account', async () => {
      const fixedNow = 1_700_000_000_000;
      jest.spyOn(Date, 'now').mockReturnValue(fixedNow);

      usersService.getUserByEmail.mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
        verifiedAt: new Date('2026-01-01T00:00:00.000Z'),
      });

      await expect(
        service.forgotPassword({ email: 'user@example.com' }),
      ).resolves.toEqual({ accepted: true });

      expect(
        passwordResetTokensService.revokeActiveTokensForUser,
      ).toHaveBeenCalledWith('user-1');
      expect(passwordResetTokensService.createToken).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          expiresAt: new Date(fixedNow + 60 * 60 * 1000),
        }),
      );
    });
  });

  // ── resetPassword ──────────────────────────────────────────────────────────

  describe('resetPassword', () => {
    it('throws BadRequestException when no active token matches the provided token', async () => {
      usersService.getUserByEmail.mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
      });
      passwordResetTokensService.getActiveTokensByUserId.mockResolvedValue([]);

      await expect(
        service.resetPassword({
          email: 'user@example.com',
          token: 'invalid-token',
          newPassword: 'Password123!',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('updates the password hash and marks the token as consumed when the token is valid', async () => {
      usersService.getUserByEmail.mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
      });
      passwordResetTokensService.getActiveTokensByUserId.mockResolvedValue([
        { id: 'token-1', tokenHash: 'stored-token-hash' },
      ]);
      jest.mocked(passwordUtils.verifyValue).mockResolvedValue(true);

      // Make transaction() execute the callback synchronously with a mock tx that
      // supports the .update().set().where() chain used in resetPassword.
      const where = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
      const set = jest.fn().mockReturnValue({ where });
      const tx = { update: jest.fn().mockReturnValue({ set }) };
      database.transaction.mockImplementation(
        (fn: (_tx: typeof tx) => Promise<void>) => fn(tx),
      );

      const result = await service.resetPassword({
        email: 'user@example.com',
        token: 'raw-reset-token',
        newPassword: 'NewPassword123!',
      });

      expect(result).toEqual({ passwordReset: true });
      expect(database.transaction).toHaveBeenCalled();
      // tx.update is called three times: update user password, consume token, revoke others
      expect(tx.update).toHaveBeenCalledTimes(3);
    });
  });
});

// ── Mock factories ─────────────────────────────────────────────────────────────

function createDatabaseMock() {
  return {
    select: jest.fn<(...args: any[]) => any>(),
    insert: jest.fn<(...args: any[]) => any>(),
    update: jest.fn<(...args: any[]) => any>(),
    transaction: jest.fn<(...args: any[]) => any>(),
  };
}

function createUsersServiceMock() {
  return {
    getUserByEmail: jest.fn<(...args: any[]) => any>(),
    getUserCredentialsByEmail: jest.fn<(...args: any[]) => any>(),
    getUserById: jest.fn<(...args: any[]) => any>(),
  };
}

function createRedisServiceMock() {
  return {
    blacklistToken: jest.fn<(...args: any[]) => any>(),
    isTokenBlacklisted: jest.fn<(...args: any[]) => any>(),
  };
}

function createMailServiceMock() {
  return {
    sendVerificationEmail: jest
      .fn<() => Promise<void>>()
      .mockResolvedValue(undefined),
    sendPasswordResetEmail: jest
      .fn<() => Promise<void>>()
      .mockResolvedValue(undefined),
  };
}

function createPasswordResetTokensServiceMock() {
  return {
    revokeActiveTokensForUser: jest.fn<(...args: any[]) => any>(),
    createToken: jest.fn<(...args: any[]) => any>(),
    getActiveTokensByUserId:
      jest.fn<() => Promise<Array<{ id: string; tokenHash: string }>>>(),
    revokeOtherActiveTokensForUser: jest.fn<(...args: any[]) => any>(),
  };
}

function createConfigServiceMock() {
  return {
    getOrThrow: jest.fn((key: string) => {
      if (key === 'PASSWORD_RESET_TOKEN_EXPIRY_HOURS') return 1;
      if (key === 'EMAIL_VERIFICATION_TOKEN_EXPIRY_HOURS') return 24;
      return undefined;
    }),
  };
}
