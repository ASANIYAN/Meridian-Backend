import * as Y from 'yjs';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AiService } from './ai.service';
import { YjsService } from '../yjs/yjs.service';
import { SnapshotsService } from '../snapshots/snapshots.service';
import { OperationsService } from '../operations/operations.service';
import { OutboxService } from '../outbox/outbox.service';
import { DATABASE_CONNECTION } from '../database/database-connection';

type MockFn = jest.Mock<(...args: any[]) => any>;

function makeSnapshotBlob(text: string): Buffer {
  const doc = new Y.Doc();
  doc.getText('content').insert(0, text);
  return Buffer.from(Y.encodeStateAsUpdate(doc));
}

const SNAPSHOT_BASE = {
  id: 'snap-id',
  documentId: 'doc-id',
  versionVector: {},
  createdAt: new Date(),
};

describe('AiService', () => {
  let service: AiService;

  const mockTx = {};
  const mockDb = {
    transaction: jest.fn<(...args: any[]) => any>(),
  };

  const mockOperationsService = {
    getOperationsSinceSequence: jest.fn<(...args: any[]) => any>(),
    acquireDocumentWriteLock: jest.fn<(...args: any[]) => any>(),
    getMaxClockValue: jest.fn<(...args: any[]) => any>(),
    insertOperation: jest.fn<(...args: any[]) => any>(),
  };

  const mockOutboxService = {
    insertOutboxEntry: jest.fn<(...args: any[]) => any>(),
    enqueueDelivery: jest.fn<(...args: any[]) => any>(),
  };

  const mockSnapshotsService = {
    getLatestSnapshot: jest.fn<(...args: any[]) => any>(),
  };

  const mockConfigService: { get: MockFn; getOrThrow: MockFn } = {
    get: jest.fn((_: any, defaultVal?: unknown) => defaultVal),
    getOrThrow: jest
      .fn<(...args: any[]) => any>()
      .mockReturnValue('fake-api-key'),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockDb.transaction.mockImplementation(
      async (cb: (tx: unknown) => unknown) => await cb(mockTx),
    );
    mockOperationsService.getOperationsSinceSequence.mockResolvedValue([]);
    mockOperationsService.acquireDocumentWriteLock.mockResolvedValue(undefined);
    mockOperationsService.getMaxClockValue.mockResolvedValue(0n);
    mockOperationsService.insertOperation.mockResolvedValue({
      id: 'op-id',
      operationSequence: 1,
      source: 'ai',
    });
    mockOutboxService.insertOutboxEntry.mockResolvedValue('outbox-id');
    mockOutboxService.enqueueDelivery.mockResolvedValue(undefined);
    mockSnapshotsService.getLatestSnapshot.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiService,
        YjsService,
        { provide: DATABASE_CONNECTION, useValue: mockDb },
        { provide: OperationsService, useValue: mockOperationsService },
        { provide: OutboxService, useValue: mockOutboxService },
        { provide: SnapshotsService, useValue: mockSnapshotsService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<AiService>(AiService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('chat — Yjs translation and pipeline', () => {
    describe('insert operation', () => {
      it('inserts one row with type insert and source ai', async () => {
        jest
          .spyOn(service as any, 'callLLM')
          .mockResolvedValue(
            JSON.stringify([{ type: 'insert', position: 0, text: 'AI text' }]),
          );
        jest.spyOn(service as any, 'checkScope').mockResolvedValue(undefined);

        const result = await service.chat('doc-id', 'user-id', 'prepend text');

        expect(result).toEqual({ operations_applied: 1 });
        expect(mockOperationsService.insertOperation).toHaveBeenCalledTimes(1);
        expect(mockOperationsService.insertOperation).toHaveBeenCalledWith(
          mockTx,
          expect.objectContaining({ type: 'insert', source: 'ai' }),
        );
        expect(mockOutboxService.enqueueDelivery).toHaveBeenCalledTimes(1);
      });

      it('passes the per-op binary to both insertOperation and insertOutboxEntry', async () => {
        jest
          .spyOn(service as any, 'callLLM')
          .mockResolvedValue(
            JSON.stringify([{ type: 'insert', position: 0, text: 'hello' }]),
          );
        jest.spyOn(service as any, 'checkScope').mockResolvedValue(undefined);

        await service.chat('doc-id', 'user-id', 'insert');

        const insertedBinary = (
          mockOperationsService.insertOperation.mock.calls[0][1] as {
            yjsUpdate: Buffer;
          }
        ).yjsUpdate;
        const outboxBinary = (
          mockOutboxService.insertOutboxEntry.mock.calls[0][1] as {
            payload: Buffer;
          }
        ).payload;

        expect(Buffer.isBuffer(insertedBinary)).toBe(true);
        expect(insertedBinary).toEqual(outboxBinary);
      });
    });

    describe('delete operation', () => {
      it('inserts one row with type delete and source ai', async () => {
        mockSnapshotsService.getLatestSnapshot.mockResolvedValue({
          ...SNAPSHOT_BASE,
          contentBlob: makeSnapshotBlob('hello'),
          operationSequence: 0,
        });

        jest.spyOn(service as any, 'callLLM').mockResolvedValue(
          JSON.stringify([
            {
              type: 'delete',
              start: 0,
              end: 5,
              expected_text: 'hello',
            },
          ]),
        );
        jest.spyOn(service as any, 'checkScope').mockResolvedValue(undefined);

        const result = await service.chat('doc-id', 'user-id', 'delete hello');

        expect(result).toEqual({ operations_applied: 1 });
        expect(mockOperationsService.insertOperation).toHaveBeenCalledWith(
          mockTx,
          expect.objectContaining({ type: 'delete', source: 'ai' }),
        );
      });
    });

    describe('format operation', () => {
      it('inserts one row with type format and source ai', async () => {
        mockSnapshotsService.getLatestSnapshot.mockResolvedValue({
          ...SNAPSHOT_BASE,
          contentBlob: makeSnapshotBlob('hello'),
          operationSequence: 0,
        });

        jest.spyOn(service as any, 'callLLM').mockResolvedValue(
          JSON.stringify([
            {
              type: 'format',
              start: 0,
              end: 5,
              attributes: { bold: true },
              expected_text: 'hello',
            },
          ]),
        );
        jest.spyOn(service as any, 'checkScope').mockResolvedValue(undefined);

        const result = await service.chat('doc-id', 'user-id', 'bold hello');

        expect(result).toEqual({ operations_applied: 1 });
        expect(mockOperationsService.insertOperation).toHaveBeenCalledWith(
          mockTx,
          expect.objectContaining({ type: 'format', source: 'ai' }),
        );
      });
    });

    describe('multiple operations', () => {
      it('inserts one row per op and enqueues delivery for each', async () => {
        mockOperationsService.insertOperation
          .mockResolvedValueOnce({ id: 'op-1', operationSequence: 1 })
          .mockResolvedValueOnce({ id: 'op-2', operationSequence: 2 });
        mockOutboxService.insertOutboxEntry
          .mockResolvedValueOnce('outbox-1')
          .mockResolvedValueOnce('outbox-2');

        jest.spyOn(service as any, 'callLLM').mockResolvedValue(
          JSON.stringify([
            { type: 'insert', position: 0, text: 'first ' },
            { type: 'insert', position: 6, text: 'second' },
          ]),
        );
        jest.spyOn(service as any, 'checkScope').mockResolvedValue(undefined);

        const result = await service.chat(
          'doc-id',
          'user-id',
          'add two inserts',
        );

        expect(result).toEqual({ operations_applied: 2 });
        expect(mockOperationsService.insertOperation).toHaveBeenCalledTimes(2);
        expect(mockOutboxService.insertOutboxEntry).toHaveBeenCalledTimes(2);
        expect(mockOutboxService.enqueueDelivery).toHaveBeenCalledTimes(2);
        expect(mockOutboxService.enqueueDelivery).toHaveBeenNthCalledWith(
          1,
          'outbox-1',
        );
        expect(mockOutboxService.enqueueDelivery).toHaveBeenNthCalledWith(
          2,
          'outbox-2',
        );
      });
    });

    describe('all ops rejected by content check', () => {
      it('skips transaction and returns operations_applied 0 with rejected list', async () => {
        // Doc is empty (no snapshot), so expected_text 'hello' at 0-5 has
        // similarity 0 against '' — below fuzzy threshold, goes to rejected bucket.
        jest.spyOn(service as any, 'callLLM').mockResolvedValue(
          JSON.stringify([
            {
              type: 'delete',
              start: 0,
              end: 5,
              expected_text: 'hello',
            },
          ]),
        );

        const result = await service.chat('doc-id', 'user-id', 'delete hello');

        expect(result.operations_applied).toBe(0);
        expect(result.rejected_operations).toHaveLength(1);
        expect(mockOperationsService.insertOperation).not.toHaveBeenCalled();
        expect(mockOutboxService.enqueueDelivery).not.toHaveBeenCalled();
      });
    });
  });
});
