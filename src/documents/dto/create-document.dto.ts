import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class CreateDocumentDto {
  @ApiProperty({
    example: 'Sample Document',
  })
  @IsString()
  @IsNotEmpty()
  title!: string;
}
