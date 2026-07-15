import { IsBoolean, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class UpdateCashCollectionPolicyDto {
  @IsBoolean()
  enabled!: boolean;

  @IsInt()
  @Min(0)
  @Max(10)
  allowedCreditDeliveries!: number;

  @IsNumber()
  @Min(0)
  minExposureFloor!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxOutstandingCeiling?: number | null;
}
