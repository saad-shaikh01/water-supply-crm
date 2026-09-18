import { IsString, MaxLength, MinLength } from 'class-validator';

/** Voids a StandaloneCrewCashExpense (status flip to VOIDED — never a DELETE). A written reason is mandatory. */
export class VoidStandaloneCrewCashDto {
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason: string;
}
