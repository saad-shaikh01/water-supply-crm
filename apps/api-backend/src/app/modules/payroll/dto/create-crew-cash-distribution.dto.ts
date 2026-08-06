import { ArrayMinSize, IsArray, IsEnum, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { CrewCashCategory } from '@prisma/client';

/**
 * `dailySheetId` comes from the route param, not the body (mirrors the
 * expense/damage-case pattern of scoping via URL). `date` is never
 * client-supplied — it always defaults to the sheet's own `date` field
 * (doc §4: "not editable").
 */
export class CreateCrewCashDistributionDto {
  @IsUUID()
  employeeId: string;

  @IsEnum(CrewCashCategory)
  category: CrewCashCategory;

  /** Whole positive rupees only — a magnitude, never signed (doc §5). */
  @IsInt()
  @Min(1)
  amount: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(0)
  photoKeys?: string[];
}
