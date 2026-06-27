import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class AcceptProposalRequestDto {
  @ApiPropertyOptional({
    description:
      'Set to true to apply despite a fuzzy match found when the proposal was re-validated against the live document. Required only after a 409 requires_confirmation response.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  confirm?: boolean;
}
