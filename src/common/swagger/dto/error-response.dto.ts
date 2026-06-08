import { ApiProperty } from '@nestjs/swagger';

export class ErrorResponseDto {
  @ApiProperty({
    example: 401,
  })
  statusCode: number;

  @ApiProperty({
    example: 'Authentication required',
  })
  message: string;

  @ApiProperty({
    example: 'Unauthorized',
  })
  error: string;
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
