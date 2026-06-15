import { ApiProperty } from '@nestjs/swagger';
import {
  membershipModeEnum,
  membershipRoleEnum,
} from '../../memberships/schema';

export class DocumentMemberDto {
  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  id!: string;

  @ApiProperty({ example: 'Jane' })
  firstName!: string;

  @ApiProperty({ example: 'Doe' })
  lastName!: string;

  @ApiProperty({
    enum: membershipRoleEnum.enumValues,
    example: 'author',
  })
  role!: (typeof membershipRoleEnum.enumValues)[number];

  @ApiProperty({
    enum: membershipModeEnum.enumValues,
    example: 'invite',
  })
  membershipMode!: (typeof membershipModeEnum.enumValues)[number];

  @ApiProperty({ example: '2026-06-08T10:00:00.000Z' })
  createdAt!: string;
}
