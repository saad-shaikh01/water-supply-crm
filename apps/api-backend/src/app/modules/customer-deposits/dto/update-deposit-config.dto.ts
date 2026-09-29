import { IsBoolean } from 'class-validator';

/** Turns the Customer Deposits feature on/off for the whole vendor. */
export class UpdateDepositConfigDto {
  @IsBoolean()
  depositsEnabled!: boolean;
}
