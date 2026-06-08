import {
  IsEmail,
  IsString,
  IsStrongPassword,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({
    example: 'jane@example.com',
  })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  'email': string;

  @ApiProperty({
    example: 'Password123!',
    minLength: 8,
    maxLength: 32,
  })
  @IsStrongPassword()
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  @MaxLength(32, { message: 'Password cannot exceed 32 characters' })
  'password': string;

  @ApiProperty({
    example: 'Jane',
  })
  @IsString()
  'firstName': string;

  @ApiProperty({
    example: 'Doe',
  })
  @IsString()
  'lastName': string;
}

export class VerifyEmailDto {
  @ApiProperty({
    example: 'jane@example.com',
  })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  'email': string;

  @ApiProperty({
    example: '2d69f8d7c1234b7db5c4d2f413c2d0f76f7a3c7abf5f2c1d4e6a1b0c9d8e7f6',
  })
  @IsString()
  'token': string;
}

export class ResendVerificationEmailDto {
  @ApiProperty({
    example: 'jane@example.com',
  })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  'email': string;
}

export class LoginDto {
  @ApiProperty({
    example: 'jane@example.com',
  })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  'email': string;

  @ApiProperty({
    example: 'Password123!',
  })
  @IsString()
  'password': string;
}

export class ForgotPasswordDto {
  @ApiProperty({
    example: 'jane@example.com',
  })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  'email': string;
}

export class ResetPasswordDto {
  @ApiProperty({
    example: 'jane@example.com',
  })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  'email': string;

  @ApiProperty({
    example: '2d69f8d7c1234b7db5c4d2f413c2d0f76f7a3c7abf5f2c1d4e6a1b0c9d8e7f6',
  })
  @IsString()
  'token': string;

  @ApiProperty({
    example: 'Password123!',
    minLength: 8,
    maxLength: 32,
  })
  @IsStrongPassword()
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  @MaxLength(32, { message: 'Password cannot exceed 32 characters' })
  'newPassword': string;
}
