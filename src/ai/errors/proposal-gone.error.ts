// A staged proposal could not be found — it expired, was already consumed by an
// accept, or never existed. Maps to 410 Gone so the frontend can specifically prompt
// "this suggestion expired, ask again" rather than a generic not-found.
export class ProposalGoneError extends Error {
  constructor() {
    super('This proposal no longer exists; ask the AI again');
    this.name = 'ProposalGoneError';
  }
}
