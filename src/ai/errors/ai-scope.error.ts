export class AiScopeError extends Error {
  constructor(public readonly reason: string) {
    super(`Check 3: scope violation; ${reason}`);
    this.name = 'AiScopeError';
  }
}
