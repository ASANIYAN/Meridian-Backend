import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { MembershipsService } from './memberships.service';
import { DATABASE_CONNECTION } from '../database/database-connection';
import { UsersService } from '../users/users.service';

describe('MembershipsService', () => {
  let service: MembershipsService;
  let database: ReturnType<typeof createDatabaseMock>;
  let usersService: ReturnType<typeof createUsersServiceMock>;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(async () => {
    database = createDatabaseMock();
    usersService = createUsersServiceMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MembershipsService,
        { provide: DATABASE_CONNECTION, useValue: database },
        { provide: UsersService, useValue: usersService },
      ],
    }).compile();

    service = module.get<MembershipsService>(MembershipsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── getUserDocumentMembership ───────────────────────────────────────────────

  describe('getUserDocumentMembership', () => {
    it('returns the membership row when found', async () => {
      const membership = {
        id: 'membership-1',
        documentId: 'doc-1',
        userId: 'user-1',
        role: 'author',
        membershipMode: 'invite',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const where = jest.fn().mockResolvedValue([membership]);
      const from = jest.fn().mockReturnValue({ where });
      database.select.mockReturnValue({ from });

      const result = await service.getUserDocumentMembership('doc-1', 'user-1');

      expect(result).toEqual(membership);
    });

    it('returns undefined when no membership exists', async () => {
      const where = jest.fn().mockResolvedValue([]);
      const from = jest.fn().mockReturnValue({ where });
      database.select.mockReturnValue({ from });

      const result = await service.getUserDocumentMembership('doc-1', 'user-1');

      expect(result).toBeUndefined();
    });
  });

  // ── addMember ──────────────────────────────────────────────────────────────

  describe('addMember', () => {
    const user = {
      id: 'user-1',
      firstName: 'Alice',
      lastName: 'Smith',
      email: 'alice@example.com',
      verifiedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('returns a shaped member with the correct role for editor', async () => {
      usersService.getUserByEmail.mockResolvedValue(user);

      const membershipRow = {
        id: 'membership-1',
        documentId: 'doc-1',
        userId: 'user-1',
        role: 'editor' as const,
        membershipMode: 'invite' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const returning = jest.fn().mockResolvedValue([membershipRow]);
      const onConflictDoNothing = jest.fn().mockReturnValue({ returning });
      const values = jest.fn().mockReturnValue({ onConflictDoNothing });
      database.insert.mockReturnValue({ values });

      const result = await service.addMember(
        'doc-1',
        'alice@example.com',
        'editor',
      );

      expect(result).toEqual({
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        role: 'editor',
        membershipMode: 'invite',
        createdAt: membershipRow.createdAt,
      });
    });

    it('returns a shaped member with the correct role for viewer', async () => {
      usersService.getUserByEmail.mockResolvedValue(user);

      const membershipRow = {
        id: 'membership-1',
        documentId: 'doc-1',
        userId: 'user-1',
        role: 'viewer' as const,
        membershipMode: 'invite' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const returning = jest.fn().mockResolvedValue([membershipRow]);
      const onConflictDoNothing = jest.fn().mockReturnValue({ returning });
      const values = jest.fn().mockReturnValue({ onConflictDoNothing });
      database.insert.mockReturnValue({ values });

      const result = await service.addMember(
        'doc-1',
        'alice@example.com',
        'viewer',
      );

      expect(result.role).toBe('viewer');
    });

    it('throws NotFoundException when the user does not exist', async () => {
      usersService.getUserByEmail.mockResolvedValue(undefined);

      await expect(
        service.addMember('doc-1', 'nobody@example.com', 'editor'),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(database.insert).not.toHaveBeenCalled();
    });

    it('throws ConflictException (409) when the user is already a member', async () => {
      usersService.getUserByEmail.mockResolvedValue(user);

      // onConflictDoNothing fires: insert returns empty array
      const returning = jest.fn().mockResolvedValue([]);
      const onConflictDoNothing = jest.fn().mockReturnValue({ returning });
      const values = jest.fn().mockReturnValue({ onConflictDoNothing });
      database.insert.mockReturnValue({ values });

      await expect(
        service.addMember('doc-1', 'alice@example.com', 'editor'),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  // ── updateMemberRole ───────────────────────────────────────────────────────

  describe('updateMemberRole', () => {
    it('returns the updated member with user info on success', async () => {
      const membershipRow = {
        id: 'membership-1',
        documentId: 'doc-1',
        userId: 'user-1',
        role: 'editor' as const,
        membershipMode: 'invite' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const userRow = { id: 'user-1', firstName: 'Alice', lastName: 'Smith' };

      // First DB call: update().set().where().returning()
      const returningUpdate = jest.fn().mockResolvedValue([membershipRow]);
      const whereUpdate = jest
        .fn()
        .mockReturnValue({ returning: returningUpdate });
      const set = jest.fn().mockReturnValue({ where: whereUpdate });
      database.update.mockReturnValue({ set });

      // Second DB call: select().from().where()
      const whereSelect = jest.fn().mockResolvedValue([userRow]);
      const from = jest.fn().mockReturnValue({ where: whereSelect });
      database.select.mockReturnValue({ from });

      const result = await service.updateMemberRole(
        'doc-1',
        'user-1',
        'editor',
      );

      expect(result).toEqual({
        id: userRow.id,
        firstName: userRow.firstName,
        lastName: userRow.lastName,
        role: 'editor',
        membershipMode: 'invite',
        createdAt: membershipRow.createdAt,
      });
    });

    it('throws NotFoundException when the membership does not exist', async () => {
      const returningUpdate = jest.fn().mockResolvedValue([]);
      const whereUpdate = jest
        .fn()
        .mockReturnValue({ returning: returningUpdate });
      const set = jest.fn().mockReturnValue({ where: whereUpdate });
      database.update.mockReturnValue({ set });

      await expect(
        service.updateMemberRole('doc-1', 'user-1', 'editor'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ── removeMember ───────────────────────────────────────────────────────────

  describe('removeMember', () => {
    it('calls delete with the correct documentId and userId', async () => {
      const where = jest.fn().mockResolvedValue(undefined);
      database.delete.mockReturnValue({ where });

      await service.removeMember('doc-1', 'user-1');

      expect(database.delete).toHaveBeenCalledTimes(1);
      expect(where).toHaveBeenCalledTimes(1);
    });
  });

  // ── addMemberViaLink ───────────────────────────────────────────────────────

  describe('addMemberViaLink', () => {
    const user = {
      id: 'user-1',
      firstName: 'Alice',
      lastName: 'Smith',
      email: 'alice@example.com',
      verifiedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('throws ConflictException when the user is already a member', async () => {
      const existingMembership = {
        id: 'membership-1',
        documentId: 'doc-1',
        userId: 'user-1',
        role: 'viewer',
        membershipMode: 'link',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const where = jest.fn().mockResolvedValue([existingMembership]);
      const from = jest.fn().mockReturnValue({ where });
      database.select.mockReturnValue({ from });

      await expect(
        service.addMemberViaLink('doc-1', 'user-1', 'viewer'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('creates a membership with membershipMode "link" and the correct role', async () => {
      // getUserDocumentMembership → no existing membership
      const where = jest.fn().mockResolvedValue([]);
      const from = jest.fn().mockReturnValue({ where });
      database.select.mockReturnValue({ from });

      usersService.getUserById.mockResolvedValue(user);

      const memberRow = {
        id: 'membership-2',
        documentId: 'doc-1',
        userId: 'user-1',
        role: 'editor' as const,
        membershipMode: 'link' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const returning = jest.fn().mockResolvedValue([memberRow]);
      const values = jest.fn().mockReturnValue({ returning });
      database.insert.mockReturnValue({ values });

      const result = await service.addMemberViaLink(
        'doc-1',
        'user-1',
        'editor',
      );

      expect(result.membershipMode).toBe('link');
      expect(result.role).toBe('editor');
      expect(result.id).toBe(user.id);
    });
  });
});

// ── Mock factories ─────────────────────────────────────────────────────────────

function createDatabaseMock() {
  return {
    select: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
}

function createUsersServiceMock() {
  return {
    getUserByEmail: jest.fn(),
    getUserById: jest.fn(),
  };
}
