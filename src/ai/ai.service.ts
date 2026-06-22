import * as Y from 'yjs';
import * as schema from '../database/schema';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { YjsService } from '../yjs/yjs.service';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { SnapshotsService } from '../snapshots/snapshots.service';
import { OperationsService } from '../operations/operations.service';
import { OutboxService } from '../outbox/outbox.service';
import { DATABASE_CONNECTION } from '../database/database-connection';
import { AiValidationError } from './errors/ai-validation.error';

type InsertOp = { type: 'insert'; position: number; text: string };
type DeleteOp = { type: 'delete'; start: number; end: number };
type FormatOp = {
  type: 'format';
  start: number;
  end: number;
  attributes: Record<string, unknown>;
};
type AiOp = InsertOp | DeleteOp | FormatOp;

@Injectable()
export class AiService {
  private readonly genAI: GoogleGenerativeAI;

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly database: NodePgDatabase<typeof schema>,
    private readonly yjsService: YjsService,
    private readonly outboxService: OutboxService,
    private readonly configService: ConfigService,
    private readonly snapshotService: SnapshotsService,
    private readonly operationsService: OperationsService,
  ) {
    this.genAI = new GoogleGenerativeAI(
      this.configService.getOrThrow<string>('GEMINI_API_KEY'),
    );
  }

  async chat(
    documentId: string,
    userId: string,
    message: string,
  ): Promise<{ operations_applied: number }> {
    // Reconstruct Y.Doc from latest snapshot + any unflushed delta ops
    const snapshot = await this.snapshotService.getLatestSnapshot(documentId);
    const deltaOps = await this.operationsService.getOperationsSinceSequence(
      documentId,
      snapshot?.operationSequence ?? 0,
    );

    const doc = new Y.Doc();
    if (snapshot) {
      this.yjsService.decodeUpdate(doc, snapshot.contentBlob);
    }
    for (const op of deltaOps) {
      if (op.yjsUpdate) {
        this.yjsService.decodeUpdate(doc, op.yjsUpdate);
      }
    }

    // Capture state vector before AI mutations so Y.encodeStateAsUpdate can diff later
    const originalVector = Y.encodeStateVector(doc);
    const currentText = this.yjsService.extractText(doc);

    // Call Gemini
    const model = this.genAI.getGenerativeModel({
      model: this.configService.get<string>('GEMINI_MODEL', 'gemini-2.5-flash'),
      generationConfig: {
        maxOutputTokens: this.configService.get<number>('AI_MAX_TOKENS', 1000),
        responseMimeType: 'application/json',
      },
    });

    const result = await model.generateContent(
      this.buildPrompt(currentText, message),
    );
    const raw = result.response.text();

    // Parse and validate — throws AiValidationError on bad shape
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new AiValidationError('LLM returned a non-JSON response');
    }

    const ops = this.validateOperations(parsed);

    // Apply each op to the reconstructed Y.Doc
    const yjsText = doc.getText('content');
    for (const op of ops) {
      if (op.type === 'insert') {
        yjsText.insert(op.position, op.text);
      } else if (op.type === 'delete') {
        yjsText.delete(op.start, op.end - op.start);
      } else {
        yjsText.format(op.start, op.end - op.start, op.attributes);
      }
    }

    // Diff from before the AI mutations which produces a single binary covering all changes
    const yjsUpdate = Buffer.from(Y.encodeStateAsUpdate(doc, originalVector));

    // Persist as one yjs_update row + outbox entry, then enqueue delivery
    const opResult = await this.database.transaction(async (tx) => {
      await this.operationsService.acquireDocumentWriteLock(tx, documentId);
      const maxClock = await this.operationsService.getMaxClockValue(
        tx,
        documentId,
      );

      const op = await this.operationsService.insertOperation(tx, {
        documentId,
        userId,
        yjsUpdate,
        type: 'yjs_update',
        payload: null,
        clockValue: maxClock + 1n,
      });

      const outboxId = await this.outboxService.insertOutboxEntry(tx, {
        documentId,
        operationId: op.id,
        payload: yjsUpdate,
      });

      return { outboxId };
    });

    await this.outboxService.enqueueDelivery(opResult.outboxId);

    return { operations_applied: ops.length };
  }

  private buildPrompt(currentText: string, message: string): string {
    return `You are an AI document editor. Return ONLY a valid JSON array with no markdown and no explanation.
Each element must be one of these three shapes:
  { "type": "insert", "position": <number>, "text": <string> }
  { "type": "delete", "start": <number>, "end": <number> }
  { "type": "format", "start": <number>, "end": <number>, "attributes": <object> }
Positions are 0-indexed character offsets in the current document text.
For "delete" and "format", end must be greater than start.

Current document:
${currentText}

Instruction: ${message}`;
  }

  private validateOperations(parsed: unknown): AiOp[] {
    if (!Array.isArray(parsed)) {
      throw new AiValidationError('LLM response is not a JSON array');
    }

    return parsed.map((item: unknown, index: number) => {
      if (typeof item !== 'object' || item === null) {
        throw new AiValidationError(
          `Operation at index ${index} is not an object`,
        );
      }

      const op = item as Record<string, unknown>;

      if (op.type === 'insert') {
        if (typeof op.position !== 'number' || op.position < 0) {
          throw new AiValidationError(
            `insert at index ${index}: "position" must be a non-negative number`,
          );
        }
        if (typeof op.text !== 'string' || op.text.length === 0) {
          throw new AiValidationError(
            `insert at index ${index}: "text" must be a non-empty string`,
          );
        }
        return {
          type: 'insert',
          position: op.position,
          text: op.text,
        };
      }

      if (op.type === 'delete') {
        if (typeof op.start !== 'number' || typeof op.end !== 'number') {
          throw new AiValidationError(
            `delete at index ${index}: "start" and "end" must be numbers`,
          );
        }
        if (op.start >= op.end) {
          throw new AiValidationError(
            `delete at index ${index}: "start" must be less than "end"`,
          );
        }
        return { type: 'delete', start: op.start, end: op.end };
      }

      if (op.type === 'format') {
        if (typeof op.start !== 'number' || typeof op.end !== 'number') {
          throw new AiValidationError(
            `format at index ${index}: "start" and "end" must be numbers`,
          );
        }
        if (op.start >= op.end) {
          throw new AiValidationError(
            `format at index ${index}: "start" must be less than "end"`,
          );
        }
        if (
          typeof op.attributes !== 'object' ||
          op.attributes === null ||
          Array.isArray(op.attributes)
        ) {
          throw new AiValidationError(
            `format at index ${index}: "attributes" must be a plain object`,
          );
        }
        return {
          type: 'format',
          start: op.start,
          end: op.end,
          attributes: op.attributes as Record<string, unknown>,
        };
      }

      throw new AiValidationError(
        `Operation at index ${index} has unknown type "${String(op.type)}"`,
      );
    });
  }
}
