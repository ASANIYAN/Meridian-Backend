export class AiValidationError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = 'AiValidationError';
  }
}
