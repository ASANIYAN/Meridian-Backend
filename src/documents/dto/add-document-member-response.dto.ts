import { ApiProperty } from '@nestjs/swagger';
import { DocumentMemberDto } from './get-document-members-response.dto';

export class AddDocumentMemberResponseDataDto {
  @ApiProperty({ type: DocumentMemberDto })
  member!: DocumentMemberDto;
}
