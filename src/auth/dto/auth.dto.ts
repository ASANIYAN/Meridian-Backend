import {
  IsEmail,
  IsString,
  IsStrongPassword,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @IsEmail({}, { message: 'Please provide a valid email address' })
  'email': string;

  @IsStrongPassword()
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  @MaxLength(32, { message: 'Password cannot exceed 32 characters' })
  'password': string;

  @IsString()
  'firstName': string;

  @IsString()
  'lastName': string;
}

export class VerifyEmailDto {
  @IsEmail({}, { message: 'Please provide a valid email address' })
  'email': string;

  @IsString()
  'token': string;
}

export class ResendVerificationEmailDto {
  @IsEmail({}, { message: 'Please provide a valid email address' })
  'email': string;
}

export class LoginDto {
  @IsEmail({}, { message: 'Please provide a valid email address' })
  'email': string;

  @IsString()
  'password': string;
}
