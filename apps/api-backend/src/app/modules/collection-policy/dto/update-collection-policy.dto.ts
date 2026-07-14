import { IsBoolean, IsNumber, Max, Min } from 'class-validator';

export class UpdateCollectionPolicyDto {
  @IsBoolean()
  enabled!: boolean;

  @IsNumber()
  @Min(0)
  minOutstandingThreshold!: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  minCollectionPercentage!: number;

  @IsNumber()
  @Min(0)
  allowedShortfall!: number;
}
