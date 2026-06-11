import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';

export class CreateShareLinkDto {
  @ApiProperty({ enum: ['editor', 'viewer'], example: 'viewer' })
  @IsIn(['editor', 'viewer'])
  role!: 'editor' | 'viewer';

  @ApiProperty({ example: false, required: false })
  @IsBoolean()
  @IsOptional()
  isSingleUse?: boolean;
}
