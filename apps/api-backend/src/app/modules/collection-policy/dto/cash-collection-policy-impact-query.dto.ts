import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';

/**
 * Prospective (not-yet-saved) settings for the §8.1 impact hint — lets the
 * settings page preview "what if I saved these values" before writing them.
 */
export class CashCollectionPolicyImpactQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10)
  allowedCreditDeliveries!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minExposureFloor!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxOutstandingCeiling?: number;
}
