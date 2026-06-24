import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import {
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  DocumentAuthorGuard,
  DocumentExistsGuard,
  DocumentMembershipGuard,
  DocumentWriteAccessGuard,
} from './documents.guards';
import { DocumentsService } from './documents.service';
import { MembershipsService } from '../memberships/memberships.service';

// Builds a minimal ExecutionContext whose request carries the supplied fields.
// The returned `request` object is mutable so tests can inspect side-effects
// (e.g. checking that membershipRole was written).
function createMockContext(fields: {
  user?: object;
  params?: Record<string, string>;
  membershipRole?: string;
}): { context: ExecutionContext; request: Record<string, unknown> } {
  const request: Record<string, unknown> = {
    user: fields.user,
    params: fields.params ?? {},
    membershipRole: fields.membershipRole,
  };
  const context = {
    switchToHttp: jest.fn().mockReturnValue({
      getRequest: jest.fn().mockReturnValue(request),
    }),
  } as unknown as ExecutionContext;
  return { context, request };
}

// ── DocumentExistsGuard ────────────────────────────────────────────────────────

describe('DocumentExistsGuard', () => {
  let guard: DocumentExistsGuard;
  let documentsService: { getDocumentById: jest.Mock };

  beforeEach(() => {
    documentsService = { getDocumentById: jest.fn() };
    guard = new DocumentExistsGuard(
      documentsService as unknown as DocumentsService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns true when the document exists and is not deleted', async () => {
    documentsService.getDocumentById.mockResolvedValue({
      id: 'doc-1',
      title: 'Test',
      status: 'active',
    });

    const { context } = createMockContext({ params: { id: 'doc-1' } });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('throws NotFoundException when the document is not found', async () => {
    documentsService.getDocumentById.mockResolvedValue(undefined);

    const { context } = createMockContext({ params: { id: 'doc-missing' } });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('throws NotFoundException when the document status is "deleted"', async () => {
    documentsService.getDocumentById.mockResolvedValue({
      id: 'doc-1',
      title: 'Test',
      status: 'deleted',
    });

    const { context } = createMockContext({ params: { id: 'doc-1' } });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

// ── DocumentMembershipGuard ────────────────────────────────────────────────────

describe('DocumentMembershipGuard', () => {
  let guard: DocumentMembershipGuard;
  let membershipsService: { getUserDocumentMembership: jest.Mock };

  beforeEach(() => {
    membershipsService = { getUserDocumentMembership: jest.fn() };
    guard = new DocumentMembershipGuard(
      membershipsService as unknown as MembershipsService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sets request.membershipRole to "author" and returns true', async () => {
    membershipsService.getUserDocumentMembership.mockResolvedValue({
      role: 'author',
    });

    const { context, request } = createMockContext({
      user: { userId: 'user-1' },
      params: { id: 'doc-1' },
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.membershipRole).toBe('author');
  });

  it('sets request.membershipRole to "editor" and returns true', async () => {
    membershipsService.getUserDocumentMembership.mockResolvedValue({
      role: 'editor',
    });

    const { context, request } = createMockContext({
      user: { userId: 'user-1' },
      params: { id: 'doc-1' },
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.membershipRole).toBe('editor');
  });

  it('sets request.membershipRole to "viewer" and returns true', async () => {
    membershipsService.getUserDocumentMembership.mockResolvedValue({
      role: 'viewer',
    });

    const { context, request } = createMockContext({
      user: { userId: 'user-1' },
      params: { id: 'doc-1' },
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.membershipRole).toBe('viewer');
  });

  it('throws ForbiddenException (403) when the user has no membership', async () => {
    membershipsService.getUserDocumentMembership.mockResolvedValue(undefined);

    const { context } = createMockContext({
      user: { userId: 'user-1' },
      params: { id: 'doc-1' },
    });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('throws UnauthorizedException when the request has no user', async () => {
    const { context } = createMockContext({
      user: undefined,
      params: { id: 'doc-1' },
    });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});

// ── DocumentWriteAccessGuard ───────────────────────────────────────────────────

describe('DocumentWriteAccessGuard', () => {
  let guard: DocumentWriteAccessGuard;

  beforeEach(() => {
    guard = new DocumentWriteAccessGuard();
  });

  it('returns true for role "author"', () => {
    const { context } = createMockContext({
      user: { userId: 'user-1' },
      membershipRole: 'author',
    });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('returns true for role "editor"', () => {
    const { context } = createMockContext({
      user: { userId: 'user-1' },
      membershipRole: 'editor',
    });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('throws ForbiddenException for role "viewer"', () => {
    const { context } = createMockContext({
      user: { userId: 'user-1' },
      membershipRole: 'viewer',
    });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});

// ── DocumentAuthorGuard ────────────────────────────────────────────────────────

describe('DocumentAuthorGuard', () => {
  let guard: DocumentAuthorGuard;

  beforeEach(() => {
    guard = new DocumentAuthorGuard();
  });

  it('returns true for role "author"', () => {
    const { context } = createMockContext({
      user: { userId: 'user-1' },
      membershipRole: 'author',
    });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('throws ForbiddenException for role "editor"', () => {
    const { context } = createMockContext({
      user: { userId: 'user-1' },
      membershipRole: 'editor',
    });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('throws ForbiddenException for role "viewer"', () => {
    const { context } = createMockContext({
      user: { userId: 'user-1' },
      membershipRole: 'viewer',
    });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
