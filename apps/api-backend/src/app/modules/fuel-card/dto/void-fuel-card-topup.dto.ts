import { IsString, MaxLength, MinLength } from 'class-validator';

/** Voids a FuelCardTopUp (status flip to VOIDED — never a DELETE). A written reason is mandatory. */
export class VoidFuelCardTopUpDto {
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  voidReason: string;
}
