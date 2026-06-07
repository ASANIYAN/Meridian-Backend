import { ApiProperty } from '@nestjs/swagger';

export class UserRecordResponseDto {
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

export class SignupResponseDataDto {
  @ApiProperty({
    type: UserRecordResponseDto,
  })
  user!: UserRecordResponseDto;

  @ApiProperty({
    example: true,
  })
  verificationEmailQueued!: true;
}

export class VerifyEmailResponseDataDto {
  @ApiProperty({
    type: UserRecordResponseDto,
  })
  user!: UserRecordResponseDto;

  @ApiProperty({
    example: false,
  })
  alreadyVerified!: boolean;
}

export class AcceptedResponseDataDto {
  @ApiProperty({
    example: true,
  })
  accepted!: true;
}

export class JwtTokenResponseDataDto {
  @ApiProperty({
    example:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.examplePayload.exampleSignature',
  })
  token!: string;
}

export class PasswordResetResponseDataDto {
  @ApiProperty({
    example: true,
  })
  passwordReset!: true;
}

export class LogoutResponseDataDto {
  @ApiProperty({
    example: true,
  })
  success!: true;
}
