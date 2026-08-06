import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class UnlockPayrollPeriodDto {
  /** Mandatory — never allow an unlock without a recorded reason. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}
