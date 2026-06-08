import { ApiProperty } from '@nestjs/swagger';

export class UsersListItemResponseDto {
  @ApiProperty({
    example: '9f9a0f7a-2ef4-4c35-9ae1-1a271e0ed2b1',
  })
  id!: string;

  @ApiProperty({
    example: 'jane@example.com',
  })
  email!: string;

  @ApiProperty({
    example: 'Jane',
  })
  firstName!: string;

  @ApiProperty({
    example: 'Doe',
  })
  lastName!: string;

  @ApiProperty({
    example: '2026-05-11T12:00:00.000Z',
    nullable: true,
  })
  verifiedAt!: string | null;

  @ApiProperty({
    example: '2026-05-11T11:55:00.000Z',
  })
  createdAt!: string;

  @ApiProperty({
    example: '2026-05-11T12:00:00.000Z',
  })
  updatedAt!: string;
}
