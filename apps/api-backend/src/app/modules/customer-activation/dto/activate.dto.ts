import { IsString, Matches, MinLength } from 'class-validator';

export class ActivateDto {
  @IsString()
  customerCode!: string;

  @IsString()
  phoneNumber!: string;

  @IsString()
  @MinLength(8)
  @Matches(/\d/, { message: 'Password must contain at least one number.' })
  password!: string;
}
