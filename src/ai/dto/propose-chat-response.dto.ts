import { ApiProperty } from '@nestjs/swagger';

export class DiffDto {
  @ApiProperty({
    description: 'The document text the AI read when generating the proposal.',
    example: 'The quick brown fox.',
  })
  before!: string;

  @ApiProperty({
    description:
      'The document text as it would read if the proposal is applied.',
    example: 'The quick brown fox jumps over the lazy dog.',
  })
  after!: string;
}

export class ProposeChatResponseDto {
  @ApiProperty({ example: '4f9c2b1a-3e7d-4a8c-9b2e-1f6d8c0a5e3b' })
  proposalId!: string;

  @ApiProperty({ type: DiffDto })
  diff!: DiffDto;

  @ApiProperty({
    description: 'ISO timestamp after which the staged proposal expires.',
    example: '2026-06-27T12:15:00.000Z',
  })
  expiresAt!: string;
}
