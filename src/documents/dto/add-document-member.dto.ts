import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn, IsNotEmpty } from 'class-validator';

export class AddDocumentMemberDto {
  @ApiProperty({
    example: 'jane@example.com',
  })
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @IsIn(['editor', 'viewer'])
  @ApiProperty({
    enum: ['editor', 'viewer'],
  })
  role!: 'editor' | 'viewer';
}
