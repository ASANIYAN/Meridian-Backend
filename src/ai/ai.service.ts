import * as Y from 'yjs';
import * as schema from '../database/schema';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { YjsService } from '../yjs/yjs.service';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { SnapshotsService } from '../snapshots/snapshots.service';
import { OperationsService } from '../operations/operations.service';
import { OutboxService } from '../outbox/outbox.service';
import { DATABASE_CONNECTION } from '../database/database-connection';
import { AiValidationError } from './errors/ai-validation.error';
import { AiContentExistenceError } from './errors/ai-content-existence.error';
import { AiScopeError } from './errors/ai-scope.error';

type InsertOp = { type: 'insert'; position: number; text: string };
type DeleteOp = {
  type: 'delete';
  start: number;
  end: number;
  expected_text: string;
};
type FormatOp = {
  type: 'format';
  start: number;
  end: number;
  attributes: Record<string, unknown>;
  expected_text: string;
};
type AiOp = InsertOp | DeleteOp | FormatOp;

type ContentCheckResult =
  | { outcome: 'all_exact' }
  | {
      outcome: 'fuzzy_match';
      operationIndex: number;
      expectedText: string;
      actualText: string;
    }
  | {
      outcome: 'partial';
      validOps: AiOp[];
      rejectedOps: Array<{ index: number; reason: string }>;
    };

const MAX_RETRIES = 2;

@Injectable()
export class AiService {
  private readonly genAI: GoogleGenerativeAI;
  private readonly logger = new Logger(AiService.name);

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

  private truncateText(text: string): string {
    const MAX_DOC_CHARS = this.configService.get<number>(
      'AI_MAX_DOC_CHARS',
      60_000,
    );

    if (text.length <= MAX_DOC_CHARS) return text;
    const truncated = text.slice(0, MAX_DOC_CHARS);
    return `${truncated}\n\n[Document truncated at ${MAX_DOC_CHARS} characters. Remaining content omitted.]`;
  }

  private async callLLM(userMessage: string, strict: boolean): Promise<string> {
    const model = this.genAI.getGenerativeModel({
      model: this.configService.get<string>('GEMINI_MODEL', 'gemini-2.5-flash'),
      systemInstruction: strict
        ? this.buildStrictSystemPrompt()
        : this.buildSystemPrompt(),
      generationConfig: {
        maxOutputTokens: this.configService.get<number>('AI_MAX_TOKENS', 1000),
        responseMimeType: 'application/json',
      },
    });

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    });

    return result.response.text();
  }

  private levenshtein(a: string, b: string): number {
    const m = a.length,
      n = b.length;
    const dp = Array.from({ length: m + 1 }, (_, i) =>
      Array.from({ length: n + 1 }, (__, j) => (i === 0 ? j : j === 0 ? i : 0)),
    );
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] =
          a[i - 1] === b[j - 1]
            ? dp[i - 1][j - 1]
            : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
    return dp[m][n];
  }

  private similarity(a: string, b: string): number {
    if (a === b) return 1.0;
    const maxLen = Math.max(a.length, b.length);
    if (maxLen === 0) return 1.0;
    return 1 - this.levenshtein(a.trim(), b.trim()) / maxLen;
  }

  private checkContentExistence(
    ops: AiOp[],
    currentText: string,
  ): ContentCheckResult {
    const FUZZY_THRESHOLD = this.configService.get<number>(
      'AI_FUZZY_THRESHOLD',
      0.7,
    );

    const validOps: AiOp[] = [];
    const rejectedOps: Array<{ index: number; reason: string }> = [];

    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];

      // Inserts don't target existing text so always valid for Check 2
      if (op.type === 'insert') {
        validOps.push(op);
        continue;
      }

      const actualText = currentText.slice(op.start, op.end);
      const score = this.similarity(op.expected_text, actualText);

      if (score === 1.0) {
        // Exact match, proceed
        validOps.push(op);
      } else if (score >= FUZZY_THRESHOLD) {
        // Fuzzy match; stop everything, ask author to confirm
        return {
          outcome: 'fuzzy_match',
          operationIndex: i,
          expectedText: op.expected_text,
          actualText,
        };
      } else {
        // No match, reject this specific op
        rejectedOps.push({
          index: i,
          reason: `Check 2 failed: referenced text not found at positions ${op.start}-${op.end} (document may have changed)`,
        });
      }
    }

    if (rejectedOps.length > 0) {
      return { outcome: 'partial', validOps, rejectedOps };
    }

    return { outcome: 'all_exact' };
  }

  private async checkScope(instruction: string, ops: AiOp[]): Promise<void> {
    const MAX_PREVIEW_LEN = 200;
    const opSummaries = ops
      .map((op, i) => {
        if (op.type === 'insert')
          return `  Op ${i} (insert): adds "${op.text.slice(0, MAX_PREVIEW_LEN)}"`;
        if (op.type === 'delete')
          return `  Op ${i} (delete): removes "${op.expected_text.slice(0, MAX_PREVIEW_LEN)}"`;
        return `  Op ${i} (format ${JSON.stringify(op.attributes)}): applies to "${op.expected_text.slice(0, MAX_PREVIEW_LEN)}"`;
      })
      .join('\n');

    const model = this.genAI.getGenerativeModel({
      model: this.configService.get<string>('GEMINI_MODEL', 'gemini-2.5-flash'),
      systemInstruction: `You are a scope validator for an AI document editor.
Determine if ALL proposed changes are directly and exclusively related to the given instruction.
Return ONLY valid JSON: { "scope_valid": boolean, "violation_reason": string | null }
scope_valid must be true only if every single change is directly required by the instruction.
If even one change is unrelated or goes beyond the instruction, scope_valid must be false.`,
      generationConfig: {
        maxOutputTokens: 200,
        responseMimeType: 'application/json',
      },
    });

    let raw: string;
    try {
      const result = await model.generateContent({
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `Instruction: "${instruction}"\n\nProposed changes:\n${opSummaries}`,
              },
            ],
          },
        ],
      });
      raw = result.response.text();
    } catch (err) {
      this.logger.warn('Scope check LLM call failed; skipping Check 3', err);
      return;
    }

    let parsed: { scope_valid: boolean; violation_reason: string | null };
    try {
      parsed = JSON.parse(raw) as {
        scope_valid: boolean;
        violation_reason: string | null;
      };
    } catch {
      this.logger.warn(
        'Scope check LLM returned non-JSON; skipping Check 3',
        raw,
      );
      return;
    }

    if (typeof parsed.scope_valid !== 'boolean') {
      this.logger.warn(
        'Scope check LLM returned unexpected shape; skipping Check 3',
        raw,
      );
      return;
    }

    if (!parsed.scope_valid) {
      throw new AiScopeError(
        parsed.violation_reason ??
          'Operations exceed the scope of the instruction',
      );
    }
  }

  async chat(
    documentId: string,
    userId: string,
    message: string,
  ): Promise<{
    operations_applied: number;
    rejected_operations?: Array<{ index: number; reason: string }>;
  }> {
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
    const currentText = this.truncateText(this.yjsService.extractText(doc));
    const userMessage = this.buildUserMessage(currentText, message);

    let ops: AiOp[] | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const raw = await this.callLLM(userMessage, attempt > 0);

      try {
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          throw new AiValidationError('LLM returned a non-JSON response');
        }

        ops = this.validateOperations(parsed);
        break;
      } catch (error) {
        if (error instanceof AiValidationError) {
          this.logger.error(
            `AI format failure (attempt ${attempt + 1}/${MAX_RETRIES + 1}): ${error.reason}`,
            raw,
          );

          if (attempt === MAX_RETRIES) {
            throw new AiValidationError('AI response format invalid');
          }
        } else {
          throw error;
        }
      }
    }

    // Check 2 — Content existence: verify each op's referenced text still exists
    const checkResult = this.checkContentExistence(ops!, currentText);

    if (checkResult.outcome === 'fuzzy_match') {
      throw new AiContentExistenceError(
        checkResult.operationIndex,
        checkResult.expectedText,
        checkResult.actualText,
      );
    }

    let opsToApply = ops!;
    let rejectedOps: Array<{ index: number; reason: string }> = [];

    if (checkResult.outcome === 'partial') {
      opsToApply = checkResult.validOps;
      rejectedOps = checkResult.rejectedOps;
    }

    // All ops were rejected by Check 2 — nothing left to apply or scope-check
    if (opsToApply.length === 0) {
      return { operations_applied: 0, rejected_operations: rejectedOps };
    }

    // Check 3 — Scope: verify all remaining ops are related to the instruction
    await this.checkScope(message, opsToApply);

    // Apply each valid op to the reconstructed Y.Doc
    const yjsText = doc.getText('content');
    for (const op of opsToApply) {
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

    return {
      operations_applied: opsToApply.length,
      ...(rejectedOps.length > 0 && { rejected_operations: rejectedOps }),
    };
  }

  private buildUserMessage(currentText: string, message: string): string {
    return `Current document:\n${currentText}\n\nInstruction: ${message}`;
  }

  private buildSystemPrompt(): string {
    return `You are an AI document editor. You MUST respond ONLY with a valid JSON array. No prose, no markdown, no explanation — JSON only.
Each element must be one of these three shapes:
  { "type": "insert", "position": <number>, "text": <string> }
  { "type": "delete", "start": <number>, "end": <number>, "expected_text": <string> }
  { "type": "format", "start": <number>, "end": <number>, "attributes": <object>, "expected_text": <string> }
Positions are 0-indexed character offsets in the current document text.
For "delete" and "format": end must be greater than start, and "expected_text" must be the exact text currently at those positions in the document.`;
  }

  private buildStrictSystemPrompt(): string {
    return `You are an AI document editor. Your previous response was rejected because it did not match the required format.
You MUST return ONLY a raw JSON array. No text before it, no text after it, no markdown code fences, no explanation.
The response must start with [ and end with ]. Any deviation will be rejected.
Each element must be exactly one of:
  { "type": "insert", "position": <number>, "text": <string> }
  { "type": "delete", "start": <number>, "end": <number>, "expected_text": <string> }
  { "type": "format", "start": <number>, "end": <number>, "attributes": <object>, "expected_text": <string> }
Rules: positions are 0-indexed character offsets. For "delete" and "format", end must be greater than start, "text" must be a non-empty string, and "expected_text" must be the exact text currently at those positions in the document.`;
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
        if (
          typeof op.expected_text !== 'string' ||
          op.expected_text.length === 0
        ) {
          throw new AiValidationError(
            `delete at index ${index}: "expected_text" must be a non-empty string`,
          );
        }
        return {
          type: 'delete',
          start: op.start,
          end: op.end,
          expected_text: op.expected_text,
        };
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
        if (
          typeof op.expected_text !== 'string' ||
          op.expected_text.length === 0
        ) {
          throw new AiValidationError(
            `format at index ${index}: "expected_text" must be a non-empty string`,
          );
        }
        return {
          type: 'format',
          start: op.start,
          end: op.end,
          attributes: op.attributes as Record<string, unknown>,
          expected_text: op.expected_text,
        };
      }

      throw new AiValidationError(
        `Operation at index ${index} has unknown type "${String(op.type)}"`,
      );
    });
  }
}
