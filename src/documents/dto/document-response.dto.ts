import { ApiProperty } from '@nestjs/swagger';

export class DocumentRecordResponseDto {
  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  id!: string;

  @ApiProperty({ example: 'Q4 Product Roadmap' })
  title!: string;

  @ApiProperty({
    enum: ['draft', 'active', 'inactive', 'deleted'],
    example: 'draft',
  })
  status!: string;

  @ApiProperty({ example: '9f9a0f7a-2ef4-4c35-9ae1-1a271e0ed2b1' })
  createdBy!: string;

  @ApiProperty({ example: null, nullable: true })
  latestSnapshotId!: string | null;

  @ApiProperty({ example: '2026-06-08T10:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-06-08T10:00:00.000Z' })
  updatedAt!: string;
}

export class CreateDocumentResponseDataDto {
  @ApiProperty({ type: DocumentRecordResponseDto })
  document!: DocumentRecordResponseDto;
}
