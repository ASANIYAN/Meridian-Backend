import { ApiProperty } from '@nestjs/swagger';

export class ChatResponseDto {
  @ApiProperty({ example: 2 })
  operations_applied!: number;
}
