import { ApiProperty } from '@nestjs/swagger';
import { DocumentWithRoleDto } from './list-documents-response.dto';

export class DocumentWithRoleAndCountDto extends DocumentWithRoleDto {
  @ApiProperty({ example: 4 })
  memberCount!: number;
}
