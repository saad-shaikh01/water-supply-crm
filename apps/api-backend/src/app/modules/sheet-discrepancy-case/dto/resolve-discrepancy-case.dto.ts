import { IsEnum, IsInt, IsNumber, IsOptional, IsPositive, IsString, MaxLength, Min, ValidateIf } from 'class-validator';
import { DiscrepancyResolutionType } from '@prisma/client';

export class ResolveDiscrepancyCaseDto {
  @IsEnum(DiscrepancyResolutionType)
  resolutionType: DiscrepancyResolutionType;

  // Required for CHARGED_TO_DRIVER/COMPANY_LOSS — the rupee amount actually
  // charged/written-off. Omitted for WAIVED (no money moves). The
  // "WAIVED requires a reason" rule lives in the service (see resolve()) —
  // class-validator's @ValidateIf only expresses one direction cleanly, and
  // resolutionNote is shared by all three resolution types below.
  @ValidateIf((o) => o.resolutionType !== DiscrepancyResolutionType.WAIVED)
  @IsPositive()
  @IsNumber({ maxDecimalPlaces: 2 })
  resolutionAmount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  resolutionNote?: string;

  @IsInt()
  @Min(0)
  version: number;
}
