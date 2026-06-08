import { ApiProperty } from '@nestjs/swagger';

export class RootResponseDto {
  @ApiProperty({
    example: 'ok',
  })
  status!: string;

  @ApiProperty({
    example: '2026-05-11T12:00:00.000Z',
  })
  timestamp!: string;

  @ApiProperty({
    example: 'Meridian-Backend',
  })
  service!: string;

  @ApiProperty({
    example: 8000,
  })
  port!: number;
}
