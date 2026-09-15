import { IsNotEmpty, IsNumber, IsString, MaxLength, Min } from 'class-validator';

/**
 * Controlled Edit (design doc §4.4) — `costPerUnit` only, `effectiveFrom`/
 * `effectiveTo`/`productId` are never touched by this path. `note` (the
 * reason for the correction) is always mandatory here.
 */
export class EditProductCostDto {
  @IsNumber()
  @Min(0.01)
  costPerUnit: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  note: string;
}
