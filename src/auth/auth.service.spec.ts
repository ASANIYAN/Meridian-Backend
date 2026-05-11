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
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { DATABASE_CONNECTION } from '../database/database-connection';
import { RedisService } from '../redis/redis.service';
import { PasswordResetTokensService } from '../password_reset_tokens/password_reset_tokens.service';

type MockUserLookupResult = Array<{
  id: string;
  email: string;
  verifiedAt: Date | null;
}>;

type MockPasswordResetTokenResult = Array<{
  id: string;
  tokenHash: string;
}>;

describe('AuthService', () => {
  let service: AuthService;
  let database: ReturnType<typeof createDatabaseMock>;
  let redisService: ReturnType<typeof createRedisServiceMock>;
  let passwordResetTokensService: ReturnType<
    typeof createPasswordResetTokensServiceMock
  >;
  let configService: ReturnType<typeof createConfigServiceMock>;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(async () => {
    database = createDatabaseMock();
    redisService = createRedisServiceMock();
    passwordResetTokensService = createPasswordResetTokensServiceMock();
    configService = createConfigServiceMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: DATABASE_CONNECTION,
          useValue: database,
        },
        {
          provide: JwtService,
          useValue: {},
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
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('throws when logout is called without token expiry', async () => {
    await expect(
      service.logout({
        userId: 'user-1',
        email: 'user@example.com',
        jti: 'jti-1',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('blacklists the current token for its remaining lifetime on logout', async () => {
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

  it('returns accepted for forgot password when the account does not exist', async () => {
    const where = createWhereMock([]);
    const from = jest.fn().mockReturnValue({ where });
    database.select.mockReturnValue({ from });

    await expect(
      service.forgotPassword({ email: 'missing@example.com' }),
    ).resolves.toEqual({ accepted: true });

    expect(
      passwordResetTokensService.revokeActiveTokensForUser,
    ).not.toHaveBeenCalled();
    expect(passwordResetTokensService.createToken).not.toHaveBeenCalled();
  });

  it('returns accepted for forgot password when the account is unverified', async () => {
    const where = createWhereMock([
      {
        id: 'user-1',
        email: 'user@example.com',
        verifiedAt: null,
      },
    ]);
    const from = jest.fn().mockReturnValue({ where });
    database.select.mockReturnValue({ from });

    await expect(
      service.forgotPassword({ email: 'user@example.com' }),
    ).resolves.toEqual({ accepted: true });

    expect(
      passwordResetTokensService.revokeActiveTokensForUser,
    ).not.toHaveBeenCalled();
    expect(passwordResetTokensService.createToken).not.toHaveBeenCalled();
  });

  it('creates and emails a reset token for a verified account', async () => {
    const fixedNow = 1_700_000_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(fixedNow);
    const where = createWhereMock([
      {
        id: 'user-1',
        email: 'user@example.com',
        verifiedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);
    const from = jest.fn().mockReturnValue({ where });
    database.select.mockReturnValue({ from });

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

  it('rejects reset password when no active token matches', async () => {
    const where = createWhereMock([
      {
        id: 'user-1',
        email: 'user@example.com',
        verifiedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);
    const from = jest.fn().mockReturnValue({ where });
    database.select.mockReturnValue({ from });
    passwordResetTokensService.getActiveTokensByUserId.mockResolvedValue([]);

    await expect(
      service.resetPassword({
        email: 'user@example.com',
        token: 'invalid-token',
        newPassword: 'Password123!',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

function createDatabaseMock() {
  return {
    select: jest.fn(),
    transaction: jest.fn(),
  };
}

function createWhereMock(result: MockUserLookupResult) {
  return jest
    .fn<() => Promise<MockUserLookupResult>>()
    .mockResolvedValue(result);
}

function createRedisServiceMock() {
  return {
    blacklistToken: jest.fn(),
  };
}

function createPasswordResetTokensServiceMock() {
  return {
    revokeActiveTokensForUser: jest.fn(),
    createToken: jest.fn(),
    getActiveTokensByUserId:
      jest.fn<() => Promise<MockPasswordResetTokenResult>>(),
    revokeOtherActiveTokensForUser: jest.fn(),
  };
}

function createConfigServiceMock() {
  return {
    getOrThrow: jest.fn((key: string) => {
      if (key === 'PASSWORD_RESET_TOKEN_EXPIRY_HOURS') {
        return 1;
      }

      return undefined;
    }),
  };
}
