export class AiContentExistenceError extends Error {
  constructor(
    public readonly operationIndex: number,
    public readonly expectedText: string,
    public readonly actualText: string,
  ) {
    super('Check 2: fuzzy match; document may have changed');
    this.name = 'AiContentExistenceError';
  }
}
