import * as Y from 'yjs';
import * as schema from '../database/schema';
import { randomUUID } from 'node:crypto';
import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GenerationConfig, GoogleGenerativeAI } from '@google/generative-ai';
import { YjsService } from '../yjs/yjs.service';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { SnapshotsService } from '../snapshots/snapshots.service';
import { OperationsService } from '../operations/operations.service';
import { OutboxService } from '../outbox/outbox.service';
import { RedisService } from '../redis/redis.service';
import { DATABASE_CONNECTION } from '../database/database-connection';
import { AiValidationError } from './errors/ai-validation.error';
import { AiContentExistenceError } from './errors/ai-content-existence.error';
import { AiScopeError } from './errors/ai-scope.error';
import { ProposalGoneError } from './errors/proposal-gone.error';
import { AiProposalReconfirmError } from './errors/proposal-reconfirm.error';

type InsertOp = {
  type: 'insert';
  position: number;
  text: string;
  // Optional anchor: a verbatim quote of existing document text the insert should sit
  // next to. LLMs can't reliably count character offsets, so when present we locate the
  // anchor in the live text and derive the real position from it; `position` is only a
  // fallback hint used to disambiguate repeated anchors.
  anchor_text?: string;
  anchor_position?: 'before' | 'after';
};
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
  | { outcome: 'all_exact'; validOps: AiOp[] }
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

type ChatResult = {
  operations_applied: number;
  rejected_operations?: Array<{ index: number; reason: string }>;
};

// A staged proposal as stored in Redis (JSON) between propose and accept/decline.
type StagedProposal = {
  documentId: string;
  authorId: string;
  instruction: string;
  operations: AiOp[];
  diff: { before: string; after: string };
  createdAt: number;
};

const MAX_RETRIES = 2;
const OUTBOX_FRAME_HEADER = Buffer.alloc(16);

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
    private readonly redisService: RedisService,
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

  // Single place that talks to Gemini: builds a JSON-mode model with the given system
  // instruction and token budget, sends one user turn, and returns the raw text.
  private async generateJson(
    systemInstruction: string,
    userText: string,
    maxOutputTokens: number,
  ): Promise<string> {
    const model = this.genAI.getGenerativeModel({
      model: this.configService.get<string>('GEMINI_MODEL', 'gemini-3-flash'),
      systemInstruction,
      generationConfig: {
        maxOutputTokens,
        responseMimeType: 'application/json',
        // Flash is a thinking model: its reasoning tokens count against
        // maxOutputTokens and were consuming the whole budget, truncating the
        // JSON mid-output. This is deterministic extraction, so turn thinking
        // off. thinkingConfig isn't in the legacy SDK's GenerationConfig type
        // but is forwarded verbatim to the REST API.
        thinkingConfig: { thinkingBudget: 0 },
      } as GenerationConfig,
    });

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: userText }] }],
    });

    return result.response.text();
  }

  private async callLLM(userMessage: string, strict: boolean): Promise<string> {
    return this.generateJson(
      strict ? this.buildStrictSystemPrompt() : this.buildSystemPrompt(),
      userMessage,
      this.configService.get<number>('AI_MAX_TOKENS', 1000),
    );
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
    const relocatedRanges = new Map<number, number>();

    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];

      // Inserts don't target existing text, but the model's raw offset is unreliable.
      // When it supplied an anchor, resolve the real position by searching for that
      // quote; a missing anchor is a Check 2 failure just like a missing delete target.
      if (op.type === 'insert') {
        if (op.anchor_text !== undefined) {
          const match = this.findNearestExactText(
            currentText,
            op.anchor_text,
            op.position,
          );
          if (!match) {
            this.logger.warn(
              `Check 2 failed (insert anchor): ${JSON.stringify({
                operationIndex: i,
                anchorText: op.anchor_text,
                requestedPosition: op.position,
              })}`,
            );
            rejectedOps.push({
              index: i,
              reason: `Check 2 failed: insert anchor text not found (document may have changed)`,
            });
            continue;
          }
          const resolvedPosition =
            op.anchor_position === 'before' ? match.start : match.end;
          validOps.push({ ...op, position: resolvedPosition });
          continue;
        }

        const relocatedPosition = relocatedRanges.get(op.position);
        validOps.push({
          ...op,
          position: relocatedPosition ?? op.position,
        });
        continue;
      }

      const actualText = currentText.slice(op.start, op.end);

      if (op.expected_text === actualText) {
        // Exact match, proceed
        validOps.push(op);
        relocatedRanges.set(op.start, op.start);
        continue;
      }

      const relocatedStart = this.findNearestExactText(
        currentText,
        op.expected_text,
        op.start,
      );
      if (relocatedStart) {
        const relocatedOp = {
          ...op,
          start: relocatedStart.start,
          end: relocatedStart.end,
        };
        validOps.push(relocatedOp);
        relocatedRanges.set(op.start, relocatedStart.start);
        continue;
      }

      const score = this.similarity(op.expected_text, actualText);
      if (score >= FUZZY_THRESHOLD) {
        // Fuzzy match; stop everything, ask author to confirm
        return {
          outcome: 'fuzzy_match',
          operationIndex: i,
          expectedText: op.expected_text,
          actualText,
        };
      } else {
        // No match, reject this specific op
        const nearestSnippet = this.findNearestSnippet(
          currentText,
          op.expected_text,
          op.start,
        );
        this.logger.warn(
          `Check 2 failed: ${JSON.stringify({
            operationIndex: i,
            expectedText: op.expected_text,
            requestedRange: [op.start, op.end],
            actualText,
            nearestSnippet,
          })}`,
        );
        rejectedOps.push({
          index: i,
          reason: `Check 2 failed: referenced text not found at positions ${op.start}-${op.end} (document may have changed)`,
        });
      }
    }

    if (rejectedOps.length > 0) {
      return { outcome: 'partial', validOps, rejectedOps };
    }

    return { outcome: 'all_exact', validOps };
  }

  private findNearestExactText(
    text: string,
    needle: string,
    preferredStart: number,
  ): { start: number; end: number } | null {
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    let fromIndex = 0;

    while (fromIndex <= text.length) {
      const index = text.indexOf(needle, fromIndex);
      if (index === -1) break;

      const distance = Math.abs(index - preferredStart);
      if (distance < bestDistance) {
        bestIndex = index;
        bestDistance = distance;
      }
      fromIndex = index + 1;
    }

    if (bestIndex !== -1) {
      return { start: bestIndex, end: bestIndex + needle.length };
    }

    return this.findNearestWhitespaceInsensitiveText(
      text,
      needle,
      preferredStart,
    );
  }

  private findNearestWhitespaceInsensitiveText(
    text: string,
    needle: string,
    preferredStart: number,
  ): { start: number; end: number } | null {
    const normalizedNeedle = this.normalizeAnchorText(needle);
    if (!normalizedNeedle) return null;

    let best: { start: number; end: number; distance: number } | null = null;

    for (let start = 0; start < text.length; start++) {
      if (this.normalizeAnchorChar(text[start]) === '') continue;

      let normalized = '';
      let end = start;

      while (end < text.length && normalized.length < normalizedNeedle.length) {
        normalized += this.normalizeAnchorChar(text[end]);
        end++;
      }

      if (normalized === normalizedNeedle) {
        const distance = Math.abs(start - preferredStart);
        if (!best || distance < best.distance) {
          best = { start, end, distance };
        }
      }
    }

    return best ? { start: best.start, end: best.end } : null;
  }

  private normalizeAnchorText(text: string): string {
    return Array.from(text)
      .map((char) => this.normalizeAnchorChar(char))
      .join('');
  }

  private normalizeAnchorChar(char: string): string {
    return /\s/.test(char) ? ' ' : char;
  }

  private findNearestSnippet(
    text: string,
    needle: string,
    preferredStart: number,
  ): string | null {
    const firstWord = needle.trim().split(/\s+/)[0];
    if (!firstWord) return null;

    const nearest = this.findNearestExactText(text, firstWord, preferredStart);
    if (!nearest) return null;

    return text.slice(
      Math.max(0, nearest.start - 40),
      Math.min(text.length, nearest.end + 80),
    );
  }

  private async checkScope(
    instruction: string,
    ops: AiOp[],
    currentText: string,
    afterText?: string,
  ): Promise<void> {
    const MAX_PREVIEW_LEN = 200;
    const opSummaries = ops
      .map((op, i) => {
        if (op.type === 'insert')
          return `  Op ${i} (insert at ${op.position}): adds "${op.text.slice(0, MAX_PREVIEW_LEN)}"`;
        if (op.type === 'delete')
          return `  Op ${i} (delete ${op.start}-${op.end}): removes "${op.expected_text.slice(0, MAX_PREVIEW_LEN)}"`;
        return `  Op ${i} (format ${op.start}-${op.end} ${JSON.stringify(op.attributes)}): applies to "${op.expected_text.slice(0, MAX_PREVIEW_LEN)}"`;
      })
      .join('\n');

    const systemInstruction = `You are a scope validator for an AI document editor.
Determine whether the NET EDIT is within the user's instruction.
Return ONLY valid JSON: { "scope_valid": boolean, "violation_reason": string | null }
Treat delete+insert pairs at the same or nearby positions as a single replacement/rewrite, not as unrelated deletion.
For broad writing instructions such as write, rewrite, expand, summarize, improve, tailor, or make concise, deletion of existing nearby text is allowed when it is part of replacing, reorganizing, or tightening the document.
Reject only when the net edit clearly changes content unrelated to the instruction, removes relevant content without replacement, or adds unsupported unrelated material.
Do not reject merely because an operation deletes text that is relevant to the target topic if the surrounding operations replace or reorganize it.`;

    const currentPreview = currentText.slice(0, 2_000);
    const afterPreview = afterText?.slice(0, 2_000);

    let raw: string;
    try {
      raw = await this.generateJson(
        systemInstruction,
        [
          `Instruction: "${instruction}"`,
          `Current document preview:\n${currentPreview}`,
          afterPreview ? `Proposed document preview:\n${afterPreview}` : null,
          `Proposed operations:\n${opSummaries}`,
        ]
          .filter(Boolean)
          .join('\n\n'),
        300,
      );
    } catch (err) {
      this.logger.warn('Scope check LLM call failed; skipping Check 3', err);
      return;
    }

    let parsed: { scope_valid: boolean; violation_reason: string | null };
    try {
      parsed = JSON.parse(raw.trim()) as {
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

  // Apply-immediately path: generate → Check 2 → Check 3 → apply, in one request.
  async chat(
    documentId: string,
    userId: string,
    message: string,
  ): Promise<ChatResult> {
    const { doc, currentText } = await this.reconstructDocument(documentId);
    const ops = await this.generateValidatedOps(currentText, message);

    // Check 2 — Content existence: fuzzy match throws 409 here, as it always has.
    const { opsToApply, rejectedOps } = this.resolveContentCheck(
      ops,
      currentText,
    );
    this.logAiChanges('chat', documentId, {
      generatedOperations: ops,
      operationsToApply: opsToApply,
      rejectedOperations: rejectedOps,
    });

    // All ops were rejected by Check 2 — nothing left to apply or scope-check.
    if (opsToApply.length === 0) {
      return {
        operations_applied: 0,
        ...(rejectedOps.length > 0 && { rejected_operations: rejectedOps }),
      };
    }

    // Check 3 — Scope: verify all remaining ops are related to the instruction.
    await this.checkScope(message, opsToApply, currentText);

    await this.applyOps(documentId, userId, doc, opsToApply);

    return {
      operations_applied: opsToApply.length,
      ...(rejectedOps.length > 0 && { rejected_operations: rejectedOps }),
    };
  }

  // Propose: run the same pipeline as chat (generate → Check 2 → Check 3) but stop short
  // of applying. Stage the validated operations in Redis and return a previewable diff
  // plus the proposalId the author uses to later accept or decline.
  async proposeChat(
    documentId: string,
    userId: string,
    message: string,
  ): Promise<{
    proposalId: string;
    diff: { before: string; after: string };
    expiresAt: string;
  }> {
    const { doc, currentText } = await this.reconstructDocument(documentId);
    const ops = await this.generateValidatedOps(currentText, message);

    const { opsToApply, rejectedOps } = this.resolveContentCheck(
      ops,
      currentText,
    );
    this.logAiChanges('propose', documentId, {
      generatedOperations: ops,
      operationsToApply: opsToApply,
      rejectedOperations: rejectedOps,
    });

    // A proposal is a preview the author can accept later; staging a partial edit would
    // let a replacement degrade into an insert-only/delete-only change.
    if (opsToApply.length === 0 || rejectedOps.length > 0) {
      throw new ConflictException(
        'Referenced text not found; the document may have changed. Ask the AI again.',
      );
    }

    // Compute the after-state by applying to the reconstructed (and now discarded) doc.
    const after = this.computeAfterText(doc, opsToApply);
    const diff = { before: currentText, after };

    await this.checkScope(message, opsToApply, currentText, after);

    const proposalId = randomUUID();
    const ttl = this.proposalTtlSeconds();
    const proposal: StagedProposal = {
      documentId,
      authorId: userId,
      instruction: message,
      operations: opsToApply,
      diff,
      createdAt: Date.now(),
    };

    await this.redisService.stageProposal(
      proposalId,
      JSON.stringify(proposal),
      ttl,
    );

    return {
      proposalId,
      diff,
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
    };
  }

  // Accept: re-run Check 2 against the document's live state (not the snapshot captured
  // at propose time), then apply through the standard pipeline. A fuzzy match means the
  // document drifted since the preview, so we surface the updated diff and require an
  // explicit confirm rather than applying something the author didn't review.
  async acceptProposal(
    documentId: string,
    userId: string,
    proposalId: string,
    confirm: boolean,
  ): Promise<ChatResult> {
    const raw = await this.redisService.peekProposal(
      proposalId,
      this.proposalTtlSeconds(),
    );
    if (raw === null) {
      throw new ProposalGoneError();
    }

    const proposal = JSON.parse(raw) as StagedProposal;
    if (proposal.documentId !== documentId || proposal.authorId !== userId) {
      // The proposal exists but isn't this author's on this document — indistinguishable
      // from gone, as far as this caller is concerned.
      throw new ProposalGoneError();
    }

    const { doc, currentText } = await this.reconstructDocument(documentId);
    const checkResult = this.checkContentExistence(
      proposal.operations,
      currentText,
    );

    if (checkResult.outcome === 'fuzzy_match' && !confirm) {
      const after = this.computeAfterText(doc, proposal.operations);
      throw new AiProposalReconfirmError(
        { before: currentText, after },
        checkResult.operationIndex,
        checkResult.expectedText,
        checkResult.actualText,
      );
    }

    let opsToApply: AiOp[];
    let rejectedOps: Array<{ index: number; reason: string }> = [];
    if (checkResult.outcome === 'partial') {
      opsToApply = checkResult.validOps;
      rejectedOps = checkResult.rejectedOps;
    } else if (checkResult.outcome === 'all_exact') {
      opsToApply = checkResult.validOps;
    } else {
      // all_exact, or fuzzy_match with confirm === true (author reviewed the updated
      // diff and chose to apply anyway).
      opsToApply = proposal.operations;
    }
    this.logger.log(
      `AI changes accept: ${JSON.stringify({
        documentId,
        userId,
        proposalId,
        confirm,
        stagedOperations: proposal.operations,
        operationsToApply: opsToApply,
        rejectedOperations: rejectedOps,
      })}`,
    );

    // Atomically claim the proposal: only the caller that wins this GETDEL applies, so
    // a double-accept can never apply the staged operations twice.
    const claimed = await this.redisService.consumeProposal(proposalId);
    if (claimed === null) {
      throw new ProposalGoneError();
    }

    if (opsToApply.length > 0) {
      await this.applyOps(documentId, userId, doc, opsToApply);
    }

    return {
      operations_applied: opsToApply.length,
      ...(rejectedOps.length > 0 && { rejected_operations: rejectedOps }),
    };
  }

  // Decline: discard the staged proposal. Idempotent — declining an already-gone
  // proposal still succeeds, since the end state is the same either way.
  async declineProposal(proposalId: string): Promise<void> {
    await this.redisService.deleteProposal(proposalId);
  }

  private proposalTtlSeconds(): number {
    return this.configService.get<number>('AI_PROPOSAL_TTL_SECONDS', 900);
  }

  // Reconstruct the Y.Doc from the latest snapshot plus any unflushed delta ops, and
  // return both the doc and the (truncated-for-LLM) text the AI sees.
  private async reconstructDocument(
    documentId: string,
  ): Promise<{ doc: Y.Doc; currentText: string }> {
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

    // The doc was built entirely from applied updates, so its 'content' type is still a
    // bare AbstractType. Assign the concrete type before any read/edit, otherwise rich
    // (XmlFragment) docs are treated as plain text and edits never render on the client.
    this.yjsService.materializeContentType(doc);

    const currentText = this.truncateText(this.yjsService.extractText(doc));
    return { doc, currentText };
  }

  // Call the LLM with format-retry (Check 1) and return the validated operations.
  private async generateValidatedOps(
    currentText: string,
    message: string,
  ): Promise<AiOp[]> {
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
        this.logger.log(
          `Gemini structured response: ${JSON.stringify({
            attempt: attempt + 1,
            strictRetry: attempt > 0,
            raw,
            parsed,
            validatedOperations: ops,
          })}`,
        );
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

    return ops!;
  }

  // Check 2 resolution for the apply-on-pass paths (chat, propose): a fuzzy match is a
  // hard 409 stop; a partial outcome drops the unmatched ops and reports them.
  private resolveContentCheck(
    ops: AiOp[],
    currentText: string,
  ): {
    opsToApply: AiOp[];
    rejectedOps: Array<{ index: number; reason: string }>;
  } {
    const checkResult = this.checkContentExistence(ops, currentText);

    if (checkResult.outcome === 'fuzzy_match') {
      throw new AiContentExistenceError(
        checkResult.operationIndex,
        checkResult.expectedText,
        checkResult.actualText,
      );
    }

    if (checkResult.outcome === 'partial') {
      return {
        opsToApply: checkResult.validOps,
        rejectedOps: checkResult.rejectedOps,
      };
    }

    return { opsToApply: checkResult.validOps, rejectedOps: [] };
  }

  private orderOpsForApplication(ops: AiOp[]): AiOp[] {
    const hasRangeEdit = ops.some(
      (op) => op.type === 'delete' || op.type === 'format',
    );
    if (!hasRangeEdit) return ops;

    return [...ops].sort((a, b) => {
      const aPosition = a.type === 'insert' ? a.position : a.start;
      const bPosition = b.type === 'insert' ? b.position : b.start;
      if (aPosition !== bPosition) return bPosition - aPosition;

      if (a.type === 'insert' && b.type !== 'insert') return 1;
      if (a.type !== 'insert' && b.type === 'insert') return -1;
      return 0;
    });
  }

  // Apply ops to a fresh, non-truncated clone of the doc's text and return the resulting
  // text — used to build the diff preview without persisting anything.
  private computeAfterText(doc: Y.Doc, ops: AiOp[]): string {
    for (const op of this.orderOpsForApplication(ops)) {
      if (op.type === 'insert') {
        this.yjsService.insertText(doc, op.position, op.text);
      } else if (op.type === 'delete') {
        this.yjsService.deleteText(doc, op.start, op.end - op.start);
      } else {
        this.yjsService.formatText(
          doc,
          op.start,
          op.end - op.start,
          op.attributes,
        );
      }
    }
    return this.truncateText(this.yjsService.extractText(doc));
  }

  // Apply each op to the reconstructed Y.Doc, then persist operations + outbox in one
  // transaction and enqueue delivery — the same path every other document edit uses.
  private async applyOps(
    documentId: string,
    userId: string,
    doc: Y.Doc,
    ops: AiOp[],
  ): Promise<void> {
    const perOpBinaries: Buffer[] = [];

    for (const op of this.orderOpsForApplication(ops)) {
      const vectorBefore = Y.encodeStateVector(doc);
      if (op.type === 'insert') {
        this.yjsService.insertText(doc, op.position, op.text);
      } else if (op.type === 'delete') {
        this.yjsService.deleteText(doc, op.start, op.end - op.start);
      } else {
        this.yjsService.formatText(
          doc,
          op.start,
          op.end - op.start,
          op.attributes,
        );
      }

      perOpBinaries.push(Buffer.from(Y.encodeStateAsUpdate(doc, vectorBefore)));
    }

    const outboxIds = await this.database.transaction(async (tx) => {
      await this.operationsService.acquireDocumentWriteLock(tx, documentId);
      let clock = await this.operationsService.getMaxClockValue(tx, documentId);

      const ids: string[] = [];
      for (const binary of perOpBinaries) {
        clock += 1n;
        const classified = this.yjsService.classifyUpdate(binary);
        this.logger.log(
          `AI operation persisted: ${JSON.stringify({
            documentId,
            userId,
            operationIndex: ids.length,
            type: classified.type,
            payload: classified.payload,
            clockValue: clock.toString(),
            update: this.yjsService.describeUpdate(binary),
          })}`,
        );

        const inserted = await this.operationsService.insertOperation(tx, {
          documentId,
          userId,
          yjsUpdate: binary,
          type: classified.type,
          source: 'ai',
          payload: classified.payload,
          clockValue: clock,
        });

        const outboxId = await this.outboxService.insertOutboxEntry(tx, {
          documentId,
          operationId: inserted.id,
          payload: binary,
        });

        ids.push(outboxId);
      }
      return ids;
    });

    for (const outboxId of outboxIds) {
      await this.outboxService.enqueueDelivery(outboxId);
    }
    this.logger.log(
      `AI operations enqueued for delivery: ${JSON.stringify({
        documentId,
        outboxIds,
      })}`,
    );

    for (const binary of perOpBinaries) {
      try {
        const receivers = await this.redisService.publish(
          `doc:${documentId}`,
          Buffer.concat([OUTBOX_FRAME_HEADER, binary]),
        );
        this.logger.log(
          `AI operation broadcast: ${JSON.stringify({
            documentId,
            channel: `doc:${documentId}`,
            byteLength: binary.byteLength,
            subscribers: receivers,
          })}`,
        );
        if (receivers === 0) {
          this.logger.warn(
            `AI operation broadcast reached 0 subscribers for document ${documentId}; ` +
              `no gateway instance is subscribed to doc:${documentId}, so no connected client will see this edit until it rejoins.`,
          );
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        this.logger.warn(
          `Immediate AI operation broadcast failed for document ${documentId}: ${msg}`,
        );
      }
    }
  }

  private buildUserMessage(currentText: string, message: string): string {
    return `Current document:\n${currentText}\n\nInstruction: ${message}`;
  }

  private logAiChanges(
    stage: 'chat' | 'propose',
    documentId: string,
    data: {
      generatedOperations: AiOp[];
      operationsToApply: AiOp[];
      rejectedOperations: Array<{ index: number; reason: string }>;
    },
  ): void {
    this.logger.log(
      `AI changes ${stage}: ${JSON.stringify({
        documentId,
        generatedOperations: data.generatedOperations,
        operationsToApply: data.operationsToApply,
        rejectedOperations: data.rejectedOperations,
      })}`,
    );
  }

  private buildSystemPrompt(): string {
    return `You are an AI document editor. You MUST respond ONLY with a valid JSON array. No prose, no markdown, no explanation — JSON only.
Each element must be one of these three shapes:
  { "type": "insert", "position": <number>, "text": <string>, "anchor_text": <string>, "anchor_position": "before" | "after" }
  { "type": "delete", "start": <number>, "end": <number>, "expected_text": <string> }
  { "type": "format", "start": <number>, "end": <number>, "attributes": <object>, "expected_text": <string> }
Positions are 0-indexed character offsets in the current document text.
For "insert": always include "anchor_text", a short exact quote (roughly 3-8 words) copied verbatim from the current document next to where the new text belongs, and "anchor_position" set to "before" or "after" that quote. The server locates the anchor by searching the document, so the numeric "position" is only a rough hint. To append to the end of the document, quote the final words of the document as "anchor_text" with "anchor_position": "after". Only omit "anchor_text" when the document is empty.
Paragraphs in the document are separated by a blank line. To add one or more new paragraphs, put a blank line (\n\n) between them in the "text" field; each block becomes its own paragraph. Do not embed blank lines inside a single paragraph.
For "delete" and "format": end must be greater than start, and "expected_text" must be the exact text currently at those positions in the document.`;
  }

  private buildStrictSystemPrompt(): string {
    return `You are an AI document editor. Your previous response was rejected because it did not match the required format.
You MUST return ONLY a raw JSON array. No text before it, no text after it, no markdown code fences, no explanation.
The response must start with [ and end with ]. Any deviation will be rejected.
Each element must be exactly one of:
  { "type": "insert", "position": <number>, "text": <string>, "anchor_text": <string>, "anchor_position": "before" | "after" }
  { "type": "delete", "start": <number>, "end": <number>, "expected_text": <string> }
  { "type": "format", "start": <number>, "end": <number>, "attributes": <object>, "expected_text": <string> }
Rules: positions are 0-indexed character offsets. For "insert", always include "anchor_text" (a short exact quote copied verbatim from the current document) and "anchor_position" ("before" or "after" that quote); to append at the end, quote the final words with "anchor_position": "after"; only omit "anchor_text" when the document is empty. Paragraphs are separated by a blank line; to add new paragraphs, separate them with a blank line (\n\n) in "text". For "delete" and "format", end must be greater than start, "text" must be a non-empty string, and "expected_text" must be the exact text currently at those positions in the document.`;
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

        const insertOp: InsertOp = {
          type: 'insert',
          position: op.position,
          text: op.text,
        };

        if (op.anchor_text !== undefined && op.anchor_text !== '') {
          if (typeof op.anchor_text !== 'string') {
            throw new AiValidationError(
              `insert at index ${index}: "anchor_text" must be a non-empty string when provided`,
            );
          }
          const anchorPosition = op.anchor_position ?? 'after';
          if (anchorPosition !== 'before' && anchorPosition !== 'after') {
            throw new AiValidationError(
              `insert at index ${index}: "anchor_position" must be "before" or "after"`,
            );
          }
          insertOp.anchor_text = op.anchor_text;
          insertOp.anchor_position = anchorPosition;
        }

        return insertOp;
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
