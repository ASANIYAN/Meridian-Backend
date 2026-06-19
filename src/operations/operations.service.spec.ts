import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../database/schema';
import { OperationsService } from './operations.service';
import { DATABASE_CONNECTION } from '../database/database-connection';

type Db = NodePgDatabase<typeof schema>;

// Jest 30 Mock<T> requires T to be the full function signature (FunctionLike).
// Rest-param signature keeps toHaveBeenCalledWith arg-checking open while still
// allowing () => SelectChain and () => Promise<any> to be assigned (no strictFunctionTypes).
type MockFn = jest.Mock<(...args: any[]) => any>;

interface SelectChain {
  from: MockFn;
  where: MockFn;
  orderBy: MockFn;
  for: MockFn;
}

interface InsertChain {
  values: MockFn;
  returning: MockFn;
}

describe('OperationsService', () => {
  let service: OperationsService;
  let mockDb: { select: MockFn; insert: MockFn };

  /**
   * Builds a chainable Drizzle select query mock.
   * Every method returns the chain itself until `terminal`, which resolves
   * with `result`. Mirrors the fluent builder used by Drizzle:
   *   .select().from().where().orderBy()  → terminal: 'orderBy'
   *   .select().from().where()            → terminal: 'where'
   *   .select().from().where().for()      → terminal: 'for'
   */
  function makeSelectChain(
    terminal: 'orderBy' | 'where' | 'for',
    result: any,
  ): SelectChain {
    const chain = {} as SelectChain;
    // Explicit fn<() => SelectChain> so getMockImplementation() satisfies MockFn.
    chain.from = jest.fn<() => SelectChain>().mockReturnValue(chain);
    chain.where = jest.fn<() => SelectChain>().mockReturnValue(chain);
    chain.orderBy = jest.fn<() => SelectChain>().mockReturnValue(chain);
    chain.for = jest.fn<() => SelectChain>().mockReturnValue(chain);
    // Terminal method resolves the awaited chain with the test data.
    chain[terminal] = jest.fn<() => Promise<any>>().mockResolvedValue(result);
    return chain;
  }

  function makeInsertChain(result: any): InsertChain {
    const chain = {} as InsertChain;
    chain.values = jest.fn<() => InsertChain>().mockReturnValue(chain);
    chain.returning = jest.fn<() => Promise<any>>().mockResolvedValue(result);
    return chain;
  }

  beforeEach(async () => {
    mockDb = { select: jest.fn<() => any>(), insert: jest.fn<() => any>() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OperationsService,
        { provide: DATABASE_CONNECTION, useValue: mockDb },
      ],
    }).compile();

    service = module.get<OperationsService>(OperationsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getOperationsSinceSequence', () => {
    const documentId = 'doc-uuid-1';

    function makeOp(seq: number) {
      return {
        id: `op-${seq}`,
        documentId,
        userId: 'user-uuid-1',
        type: 'insert' as const,
        yjsUpdate: Buffer.from(''),
        afterId: null,
        operationSequence: seq,
        clockValue: BigInt(seq),
        payload: {},
        createdAt: new Date(),
      };
    }

    it('returns all operations when afterSequence is 0 (no-snapshot path)', async () => {
      const rows = [makeOp(1), makeOp(2), makeOp(3)];
      mockDb.select.mockReturnValue(makeSelectChain('orderBy', rows));

      const result = await service.getOperationsSinceSequence(documentId, 0);

      expect(result).toEqual(rows);
    });

    it('returns only operations after the snapshot sequence', async () => {
      const rows = [makeOp(6), makeOp(7)];
      mockDb.select.mockReturnValue(makeSelectChain('orderBy', rows));

      const result = await service.getOperationsSinceSequence(documentId, 5);

      expect(result).toEqual(rows);
    });

    it('returns an empty array when the document has no operations', async () => {
      mockDb.select.mockReturnValue(makeSelectChain('orderBy', []));

      const result = await service.getOperationsSinceSequence(documentId, 0);

      expect(result).toEqual([]);
    });

    it('calls orderBy to enforce ascending sequence ordering', async () => {
      const chain = makeSelectChain('orderBy', []);
      mockDb.select.mockReturnValue(chain);

      await service.getOperationsSinceSequence(documentId, 0);

      expect(chain.orderBy).toHaveBeenCalledTimes(1);
    });
  });

  describe('countOperationsSinceSequence', () => {
    const documentId = 'doc-uuid-1';

    it('returns the count of unsnapshotted operations', async () => {
      mockDb.select.mockReturnValue(makeSelectChain('where', [{ count: 5 }]));

      const result = await service.countOperationsSinceSequence(documentId, 10);

      expect(result).toBe(5);
    });

    it('returns 0 when no operations exist after the given sequence', async () => {
      mockDb.select.mockReturnValue(makeSelectChain('where', [{ count: 0 }]));

      const result = await service.countOperationsSinceSequence(documentId, 99);

      expect(result).toBe(0);
    });

    it('returns 0 when the query returns no rows (empty document)', async () => {
      mockDb.select.mockReturnValue(makeSelectChain('where', []));

      const result = await service.countOperationsSinceSequence(documentId, 0);

      expect(result).toBe(0);
    });
  });

  describe('getMaxClockValue', () => {
    const documentId = 'doc-uuid-1';

    it('returns the highest clock value across all operations', async () => {
      const mockTx: { select: MockFn } = {
        select: jest
          .fn<() => any>()
          .mockReturnValue(makeSelectChain('where', [{ maxClock: 42n }])),
      };

      const result = await service.getMaxClockValue(
        mockTx as unknown as Db,
        documentId,
      );

      expect(result).toBe(42n);
    });

    it('returns 0n when the aggregate is null (no operations yet)', async () => {
      const mockTx: { select: MockFn } = {
        select: jest
          .fn<() => any>()
          .mockReturnValue(makeSelectChain('where', [{ maxClock: null }])),
      };

      const result = await service.getMaxClockValue(
        mockTx as unknown as Db,
        documentId,
      );

      expect(result).toBe(0n);
    });

    it('returns 0n when the query returns no rows', async () => {
      const mockTx: { select: MockFn } = {
        select: jest
          .fn<() => any>()
          .mockReturnValue(makeSelectChain('where', [])),
      };

      const result = await service.getMaxClockValue(
        mockTx as unknown as Db,
        documentId,
      );

      expect(result).toBe(0n);
    });
  });

  describe('acquireDocumentWriteLock', () => {
    const documentId = 'doc-uuid-1';

    it('issues a FOR UPDATE select on the document row', async () => {
      const chain = makeSelectChain('for', []);
      const mockTx: { select: MockFn } = {
        select: jest.fn<() => any>().mockReturnValue(chain),
      };

      await service.acquireDocumentWriteLock(
        mockTx as unknown as Db,
        documentId,
      );

      expect(mockTx.select).toHaveBeenCalledTimes(1);
      expect(chain.for).toHaveBeenCalledWith('update');
    });
  });

  describe('insertOperation', () => {
    const documentId = 'doc-uuid-1';
    const userId = 'user-uuid-1';
    const baseInsertData = {
      documentId,
      userId,
      yjsUpdate: Buffer.from('test-update'),
      type: 'insert' as const,
      payload: { content: 'hello' },
      clockValue: 5n,
    };

    it('returns the inserted operation row', async () => {
      const row = {
        id: 'op-uuid-1',
        documentId,
        userId,
        type: 'insert' as const,
        yjsUpdate: Buffer.from('test-update'),
        afterId: null,
        operationSequence: 1,
        clockValue: 5n,
        payload: { content: 'hello' },
        createdAt: new Date(),
      };

      const mockTx: { insert: MockFn } = {
        insert: jest.fn<() => any>().mockReturnValue(makeInsertChain([row])),
      };

      const result = await service.insertOperation(
        mockTx as unknown as Db,
        baseInsertData,
      );

      expect(result).toEqual(row);
    });

    it('throws when the database returns no row', async () => {
      const mockTx: { insert: MockFn } = {
        insert: jest.fn<() => any>().mockReturnValue(makeInsertChain([])),
      };

      await expect(
        service.insertOperation(mockTx as unknown as Db, baseInsertData),
      ).rejects.toThrow('operations insert returned no rows');
    });
  });
});
