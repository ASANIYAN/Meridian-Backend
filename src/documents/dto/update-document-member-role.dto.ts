import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export class UpdateDocumentMemberRole {
  @IsIn(['editor', 'viewer'])
  @ApiProperty({ enum: ['editor', 'viewer'] })
  role!: 'editor' | 'viewer';
}
