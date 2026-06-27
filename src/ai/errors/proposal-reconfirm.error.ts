// At accept time, Check 2 re-run against the document's live state found a fuzzy
// (not exact) match — the document has drifted since the proposal was previewed, so
// what would actually apply differs from what the author reviewed. Rather than apply
// silently, we surface the updated diff and require an explicit confirm on a second
// accept. Maps to 409 Conflict with requires_confirmation: true.
export class AiProposalReconfirmError extends Error {
  constructor(
    public readonly diff: { before: string; after: string },
    public readonly operationIndex: number,
    public readonly expectedText: string,
    public readonly actualText: string,
  ) {
    super('Document has changed since this proposal was generated');
    this.name = 'AiProposalReconfirmError';
  }
}
