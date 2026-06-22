import { ApiProperty } from '@nestjs/swagger';

export class RejectedOperationDto {
  @ApiProperty({ example: 2 })
  index!: number;

  @ApiProperty({
    example: 'Check 2 failed: no matching text found at positions 40-80',
  })
  reason!: string;
}

export class ChatResponseDto {
  @ApiProperty({ example: 2 })
  operations_applied!: number;

  @ApiProperty({ type: [RejectedOperationDto], required: false })
  rejected_operations?: RejectedOperationDto[];
}
