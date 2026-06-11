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
    example:
      'https://app.example.com/join/9f9a0f7a-2ef4-4c35-9ae1-1a271e0ed2b1',
  })
  url!: string;

  @ApiProperty({ example: false })
  isSingleUse!: boolean;

  @ApiProperty({ example: '2026-06-18T12:00:00.000Z' })
  expiresAt!: string;

  @ApiProperty({ example: '2026-06-11T12:00:00.000Z' })
  createdAt!: string;
}

export class CreateShareLinkResponseDataDto {
  @ApiProperty({ type: CreateShareLinkResponseDto })
  link!: CreateShareLinkResponseDto;
}
