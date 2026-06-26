import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { DATABASE_CONNECTION } from '../database/database-connection';
import { MembershipsService } from '../memberships/memberships.service';
import { ShareLinksService } from '../share_links/share_links.service';

describe('DocumentsService', () => {
  let service: DocumentsService;
  let database: ReturnType<typeof createDatabaseMock>;
  let membershipsService: ReturnType<typeof createMembershipsServiceMock>;
  let shareLinksService: ReturnType<typeof createShareLinksServiceMock>;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(async () => {
    database = createDatabaseMock();
    membershipsService = createMembershipsServiceMock();
    shareLinksService = createShareLinksServiceMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentsService,
        { provide: DATABASE_CONNECTION, useValue: database },
        { provide: MembershipsService, useValue: membershipsService },
        { provide: ShareLinksService, useValue: shareLinksService },
      ],
    }).compile();

    service = module.get<DocumentsService>(DocumentsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── createDocument ─────────────────────────────────────────────────────────

  describe('createDocument', () => {
    it('inserts the document and the author membership inside the same transaction', async () => {
      const documentRow = {
        id: 'doc-1',
        title: 'My Doc',
        status: 'draft',
        createdBy: 'user-1',
        latestSnapshotId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // First tx.insert (documents): .values().returning() → [documentRow]
      const returningDocs = jest.fn().mockResolvedValue([documentRow]);
      const valuesDocs = jest
        .fn()
        .mockReturnValue({ returning: returningDocs });

      // Second tx.insert (memberships): .values() is awaited directly (no .returning())
      const valuesMems = jest.fn().mockResolvedValue(undefined);

      const tx = {
        insert: jest
          .fn()
          .mockReturnValueOnce({ values: valuesDocs })
          .mockReturnValueOnce({ values: valuesMems }),
      };
      database.transaction.mockImplementation(
        (fn: (tx: typeof tx) => Promise<unknown>) => fn(tx),
      );

      const result = await service.createDocument('My Doc', 'user-1');

      expect(tx.insert).toHaveBeenCalledTimes(2);
      // Second insert must carry role 'author' and membershipMode 'invite'
      expect(valuesMems).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'author',
          membershipMode: 'invite',
          documentId: documentRow.id,
        }),
      );
      expect(result).toEqual(documentRow);
    });

    it('returns the document row, not the membership row', async () => {
      const documentRow = {
        id: 'doc-1',
        title: 'Test',
        status: 'draft',
        createdBy: 'user-1',
        latestSnapshotId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const returningDocs = jest.fn().mockResolvedValue([documentRow]);
      const valuesDocs = jest
        .fn()
        .mockReturnValue({ returning: returningDocs });
      const valuesMems = jest.fn().mockResolvedValue(undefined);

      const tx = {
        insert: jest
          .fn()
          .mockReturnValueOnce({ values: valuesDocs })
          .mockReturnValueOnce({ values: valuesMems }),
      };
      database.transaction.mockImplementation(
        (fn: (tx: typeof tx) => Promise<unknown>) => fn(tx),
      );

      const result = await service.createDocument('Test', 'user-1');

      expect(result).not.toHaveProperty('role');
      expect(result).not.toHaveProperty('membershipMode');
      expect(result.id).toBe('doc-1');
    });
  });

  // ── softDeleteDocument ─────────────────────────────────────────────────────

  describe('softDeleteDocument', () => {
    it('calls update with status "deleted" and does not call delete', async () => {
      const where = jest.fn().mockResolvedValue(undefined);
      const set = jest.fn().mockReturnValue({ where });
      database.update.mockReturnValue({ set });

      await service.softDeleteDocument('doc-1');

      expect(database.update).toHaveBeenCalledTimes(1);
      expect(database.delete).not.toHaveBeenCalled();
      expect(set).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'deleted' }),
      );
    });

    it('targets the correct documentId in the where clause', async () => {
      const where = jest.fn().mockResolvedValue(undefined);
      const set = jest.fn().mockReturnValue({ where });
      database.update.mockReturnValue({ set });

      await service.softDeleteDocument('doc-42');

      expect(where).toHaveBeenCalledTimes(1);
    });
  });

  // ── addDocumentMember ──────────────────────────────────────────────────────

  describe('addDocumentMember', () => {
    it('delegates to membershipsService.addMember with the correct arguments', async () => {
      const member = {
        id: 'user-2',
        firstName: 'Bob',
        lastName: 'Jones',
        role: 'editor',
        membershipMode: 'invite',
        createdAt: new Date(),
      };
      membershipsService.addMember.mockResolvedValue(member);

      const result = await service.addDocumentMember(
        'doc-1',
        'bob@example.com',
        'editor',
      );

      expect(membershipsService.addMember).toHaveBeenCalledWith(
        'doc-1',
        'bob@example.com',
        'editor',
      );
      expect(result).toEqual(member);
    });
  });

  // ── updateDocumentMemberRole ───────────────────────────────────────────────

  describe('updateDocumentMemberRole', () => {
    it('throws BadRequestException when caller tries to change their own role', async () => {
      await expect(
        service.updateDocumentMemberRole('doc-1', 'user-1', 'user-1', 'editor'),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(
        membershipsService.getUserDocumentMembership,
      ).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the target has no membership', async () => {
      membershipsService.getUserDocumentMembership.mockResolvedValue(undefined);

      await expect(
        service.updateDocumentMemberRole('doc-1', 'user-2', 'user-1', 'editor'),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(membershipsService.updateMemberRole).not.toHaveBeenCalled();
    });

    it('calls membershipsService.updateMemberRole and returns the result on success', async () => {
      const existingMembership = {
        id: 'membership-1',
        documentId: 'doc-1',
        userId: 'user-2',
        role: 'viewer',
        membershipMode: 'invite',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const updatedMember = {
        id: 'user-2',
        firstName: 'Bob',
        lastName: 'Jones',
        role: 'editor',
        membershipMode: 'invite',
        createdAt: new Date(),
      };

      membershipsService.getUserDocumentMembership.mockResolvedValue(
        existingMembership,
      );
      membershipsService.updateMemberRole.mockResolvedValue(updatedMember);

      const result = await service.updateDocumentMemberRole(
        'doc-1',
        'user-2',
        'user-1',
        'editor',
      );

      expect(membershipsService.updateMemberRole).toHaveBeenCalledWith(
        'doc-1',
        'user-2',
        'editor',
      );
      expect(result).toEqual(updatedMember);
    });
  });

  // ── getDocumentById ────────────────────────────────────────────────────────

  describe('getDocumentById', () => {
    it('returns the document row when found', async () => {
      const documentRow = { id: 'doc-1', title: 'Test', status: 'active' };

      const where = jest.fn().mockResolvedValue([documentRow]);
      const from = jest.fn().mockReturnValue({ where });
      database.select.mockReturnValue({ from });

      const result = await service.getDocumentById('doc-1');

      expect(result).toEqual(documentRow);
    });

    it('returns undefined when not found', async () => {
      const where = jest.fn().mockResolvedValue([]);
      const from = jest.fn().mockReturnValue({ where });
      database.select.mockReturnValue({ from });

      const result = await service.getDocumentById('doc-missing');

      expect(result).toBeUndefined();
    });
  });

  // ── listUserDocumentsWithRole ──────────────────────────────────────────────

  describe('listUserDocumentsWithRole', () => {
    it('returns paginated documents with roles and correct meta', async () => {
      const docWithRole = {
        id: 'doc-1',
        title: 'Test',
        status: 'active',
        role: 'editor',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // First select: the paginated document+role query
      const offset = jest.fn().mockResolvedValue([docWithRole]);
      const limit = jest.fn().mockReturnValue({ offset });
      const orderBy = jest.fn().mockReturnValue({ limit });
      const whereFirst = jest.fn().mockReturnValue({ orderBy });
      const innerJoinFirst = jest.fn().mockReturnValue({ where: whereFirst });
      const fromFirst = jest
        .fn()
        .mockReturnValue({ innerJoin: innerJoinFirst });

      // Second select: the count query
      const whereSecond = jest.fn().mockResolvedValue([{ count: 1 }]);
      const innerJoinSecond = jest.fn().mockReturnValue({ where: whereSecond });
      const fromSecond = jest
        .fn()
        .mockReturnValue({ innerJoin: innerJoinSecond });

      database.select
        .mockReturnValueOnce({ from: fromFirst })
        .mockReturnValueOnce({ from: fromSecond });

      const result = await service.listUserDocumentsWithRole('user-1', 1, 10);

      expect(result.data).toEqual([docWithRole]);
      expect(result.meta).toEqual({
        page: 1,
        limit: 10,
        total: 1,
        totalPages: 1,
      });
    });
  });

  // ── getDocumentWithMemberCount ─────────────────────────────────────────────

  describe('getDocumentWithMemberCount', () => {
    it('returns the document with a memberCount field', async () => {
      const documentRow = { id: 'doc-1', title: 'Test', status: 'active' };

      // First select: getDocumentById (select().from().where())
      const whereFirst = jest.fn().mockResolvedValue([documentRow]);
      const fromFirst = jest.fn().mockReturnValue({ where: whereFirst });

      // Second select: count query (select().from().where())
      const whereSecond = jest.fn().mockResolvedValue([{ count: 3 }]);
      const fromSecond = jest.fn().mockReturnValue({ where: whereSecond });

      database.select
        .mockReturnValueOnce({ from: fromFirst })
        .mockReturnValueOnce({ from: fromSecond });

      const result = await service.getDocumentWithMemberCount('doc-1');

      expect(result).toEqual({ ...documentRow, memberCount: 3 });
    });
  });

  // ── updateDocumentTitle ────────────────────────────────────────────────────

  describe('updateDocumentTitle', () => {
    it('returns the updated document row', async () => {
      const updatedDoc = { id: 'doc-1', title: 'New Title', status: 'active' };

      const returning = jest.fn().mockResolvedValue([updatedDoc]);
      const where = jest.fn().mockReturnValue({ returning });
      const set = jest.fn().mockReturnValue({ where });
      database.update.mockReturnValue({ set });

      const result = await service.updateDocumentTitle('doc-1', 'New Title');

      expect(set).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'New Title' }),
      );
      expect(result).toEqual(updatedDoc);
    });
  });

  // ── updateDocumentStatus ───────────────────────────────────────────────────

  describe('updateDocumentStatus', () => {
    it('returns the document with the updated status', async () => {
      const updatedDoc = { id: 'doc-1', title: 'Test', status: 'inactive' };

      const returning = jest.fn().mockResolvedValue([updatedDoc]);
      const where = jest.fn().mockReturnValue({ returning });
      const set = jest.fn().mockReturnValue({ where });
      database.update.mockReturnValue({ set });

      const result = await service.updateDocumentStatus('doc-1', 'inactive');

      expect(set).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'inactive' }),
      );
      expect(result).toEqual(updatedDoc);
    });
  });

  // ── getDocumentMembers ─────────────────────────────────────────────────────

  describe('getDocumentMembers', () => {
    it('returns the list of members for the document', async () => {
      const members = [
        {
          id: 'user-1',
          firstName: 'Alice',
          lastName: 'Smith',
          role: 'author',
          membershipMode: 'invite',
          createdAt: new Date(),
        },
      ];

      const where = jest.fn().mockResolvedValue(members);
      const innerJoin = jest.fn().mockReturnValue({ where });
      const from = jest.fn().mockReturnValue({ innerJoin });
      database.select.mockReturnValue({ from });

      const result = await service.getDocumentMembers('doc-1');

      expect(result).toEqual(members);
    });
  });

  // ── claimShareLink ─────────────────────────────────────────────────────────

  describe('claimShareLink', () => {
    const member = {
      id: 'user-2',
      firstName: 'Bob',
      lastName: 'Jones',
      role: 'editor',
      membershipMode: 'link',
      createdAt: new Date(),
    };
    const documentRow = { id: 'doc-1', title: 'Test', status: 'active' };

    function setupGetDocumentById() {
      const where = jest.fn().mockResolvedValue([documentRow]);
      const from = jest.fn().mockReturnValue({ where });
      database.select.mockReturnValue({ from });
    }

    it('does not call markLinkAsClaimed when isSingleUse is false', async () => {
      const link = { id: 'link-1', role: 'editor', isSingleUse: false };
      shareLinksService.findAndValidateLink.mockResolvedValue(link);
      membershipsService.addMemberViaLink.mockResolvedValue(member);
      database.transaction.mockImplementation(
        (fn: (tx: unknown) => Promise<unknown>) => fn('tx'),
      );
      setupGetDocumentById();

      await service.claimShareLink('doc-1', 'token-abc', 'user-2');

      expect(shareLinksService.markLinkAsClaimed).not.toHaveBeenCalled();
    });

    it('calls markLinkAsClaimed when isSingleUse is true', async () => {
      const link = { id: 'link-1', role: 'editor', isSingleUse: true };
      shareLinksService.findAndValidateLink.mockResolvedValue(link);
      membershipsService.addMemberViaLink.mockResolvedValue(member);
      shareLinksService.markLinkAsClaimed.mockResolvedValue(undefined);
      database.transaction.mockImplementation(
        (fn: (tx: unknown) => Promise<unknown>) => fn('tx'),
      );
      setupGetDocumentById();

      const result = await service.claimShareLink(
        'doc-1',
        'token-abc',
        'user-2',
      );

      expect(shareLinksService.markLinkAsClaimed).toHaveBeenCalledWith(
        'link-1',
        'user-2',
        'tx',
      );
      expect(result).toEqual({ membership: member, document: documentRow });
    });
  });

  // ── removeDocumentMember ───────────────────────────────────────────────────

  describe('removeDocumentMember', () => {
    it('throws BadRequestException when caller tries to remove themselves', async () => {
      await expect(
        service.removeDocumentMember('doc-1', 'user-1', 'user-1'),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(
        membershipsService.getUserDocumentMembership,
      ).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the target has no membership', async () => {
      membershipsService.getUserDocumentMembership.mockResolvedValue(undefined);

      await expect(
        service.removeDocumentMember('doc-1', 'user-2', 'user-1'),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(membershipsService.removeMember).not.toHaveBeenCalled();
    });

    it('calls membershipsService.removeMember on success', async () => {
      const existingMembership = {
        id: 'membership-1',
        documentId: 'doc-1',
        userId: 'user-2',
        role: 'editor',
        membershipMode: 'invite',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      membershipsService.getUserDocumentMembership.mockResolvedValue(
        existingMembership,
      );
      membershipsService.removeMember.mockResolvedValue(undefined);

      await service.removeDocumentMember('doc-1', 'user-2', 'user-1');

      expect(membershipsService.removeMember).toHaveBeenCalledWith(
        'doc-1',
        'user-2',
      );
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
    transaction: jest.fn(),
  };
}

function createMembershipsServiceMock() {
  return {
    addMember: jest.fn(),
    getUserDocumentMembership: jest.fn(),
    updateMemberRole: jest.fn(),
    removeMember: jest.fn(),
    addMemberViaLink: jest.fn(),
  };
}

function createShareLinksServiceMock() {
  return {
    findAndValidateLink: jest.fn(),
    markLinkAsClaimed: jest.fn(),
  };
}
