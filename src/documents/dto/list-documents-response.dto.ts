import { ApiProperty } from '@nestjs/swagger';
import { DocumentRecordResponseDto } from './document-response.dto';
import { membershipRoleEnum } from '../../memberships/schema';

export class DocumentWithRoleDto extends DocumentRecordResponseDto {
  @ApiProperty({
    enum: membershipRoleEnum.enumValues,
    example: 'author',
  })
  role!: (typeof membershipRoleEnum.enumValues)[number];
}

export class ListDocumentsResponseDataDto {
  @ApiProperty({ type: DocumentWithRoleDto, isArray: true })
  documents!: DocumentWithRoleDto[];
}
