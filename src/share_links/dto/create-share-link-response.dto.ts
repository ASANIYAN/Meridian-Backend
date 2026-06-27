import { ApiProperty } from '@nestjs/swagger';

export class CreateShareLinkResponseDto {
  @ApiProperty({ example: '9f9a0f7a-2ef4-4c35-9ae1-1a271e0ed2b1' })
  id!: string;

  @ApiProperty({ example: '9f9a0f7a-2ef4-4c35-9ae1-1a271e0ed2b1' })
  documentId!: string;

  @ApiProperty({ enum: ['editor', 'viewer'], example: 'viewer' })
  role!: 'editor' | 'viewer';

  @ApiProperty({ example: '9f9a0f7a-2ef4-4c35-9ae1-1a271e0ed2b1' })
  token!: string;

  @ApiProperty({
    description:
      'Claim URL of the form {APP_URL}/join/{documentId}?token={token}. The frontend reads the document id from the path and the token from the query string to call POST /v1/documents/{id}/links/validate?token={token}.',
    example:
      'https://app.example.com/join/3fa85f64-5717-4562-b3fc-2c963f66afa6?token=9f9a0f7a-2ef4-4c35-9ae1-1a271e0ed2b1',
  })
  url!: string;

  @ApiProperty({ example: false })
  isSingleUse!: boolean;

  @ApiProperty({ example: '2026-06-18T12:00:00.000Z' })
  expiresAt!: string;

  @ApiProperty({ example: '2026-06-11T12:00:00.000Z' })
  createdAt!: string;
}
