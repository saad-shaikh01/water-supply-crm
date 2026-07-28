import { IsString } from 'class-validator';

export class CheckEligibilityDto {
  @IsString()
  customerCode!: string;

  @IsString()
  phoneNumber!: string;
}
