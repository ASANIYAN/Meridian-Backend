import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class ChatRequestDto {
  @ApiProperty({ example: 'Add a conclusion paragraph at the end.' })
  @IsString()
  @IsNotEmpty()
  message!: string;
}
