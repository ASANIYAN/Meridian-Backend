import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export class UpdateDocumentStatusDto {
  @IsIn(['active', 'inactive'])
  @ApiProperty({
    enum: ['active', 'inactive'],
  })
  status!: 'active' | 'inactive';
}
