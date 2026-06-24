import { ApiProperty } from '@nestjs/swagger';

export class ErrorResponseDto {
  @ApiProperty({ example: 401 })
  statusCode: number;

  @ApiProperty({ example: 'Authentication required' })
  message: string;

  @ApiProperty({ example: 'Unauthorized' })
  error: string;

  @ApiProperty({ example: '2026-06-24T10:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: '/v1/auth/login' })
  path: string;
}

export class ValidationErrorResponseDto {
  @ApiProperty({
    example: 400,
  })
  statusCode: number;

  @ApiProperty({
    example: ['Please provide a valid email address'],
    type: [String],
  })
  message: string[];

  @ApiProperty({
    example: 'Bad Request',
  })
  error: string;
}
