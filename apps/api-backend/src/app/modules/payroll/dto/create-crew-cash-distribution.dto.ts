import { ArrayMinSize, IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
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

  /** false = paid by bank/online (not deducted from the sheet's cash hand-in). Omitted = cash. */
  @IsOptional()
  @IsBoolean()
  paidFromCash?: boolean;

  /**
   * Mandatory ONLY when the sheet is already closed (enforced in the service —
   * open-sheet adds stay zero-ceremony): why a missed entry is being added after
   * close. Kept in the audit trail, mirroring `AddClosedExpenseDto.correctionNote`.
   */
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason?: string;
}
