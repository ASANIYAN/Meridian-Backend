import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  registerDecorator,
} from 'class-validator';

@ValidatorConstraint({ name: 'atLeastOneField', async: false })
class AtLeastOneFieldConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const obj = args.object as Record<string, unknown>;
    return Object.values(obj).some((v) => v !== undefined);
  }

  defaultMessage(): string {
    return 'At least one field must be provided';
  }
}

function AtLeastOneField() {
  return function (constructor: object) {
    registerDecorator({
      name: 'atLeastOneField',
      target: constructor,
      propertyName: '',
      validator: AtLeastOneFieldConstraint,
    });
  };
}

@AtLeastOneField()
export class UpdateDocumentDto {
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  @ApiProperty({ required: false, example: 'New Title' })
  title?: string;
}
