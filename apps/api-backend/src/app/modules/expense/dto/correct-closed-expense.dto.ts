import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ExpenseCategory } from '@prisma/client';

/**
 * Post-Close Expense Correction — amend the mutable fields of an Expense row that
 * sits on an ALREADY-CLOSED daily sheet, via the dedicated
 * `PATCH /expenses/:id/correct` endpoint (the ordinary `PATCH /expenses/:id` now
 * refuses a closed-sheet expense).
 *
 * Every mutable field is optional — only the ones actually sent are applied
 * (same partial-update shape as `UpdateExpenseDto`). `correctionNote` is ALWAYS
 * required, `@Transform`-trimmed first so a whitespace-only note collapses to ""
 * and is then rejected by `@MinLength(3)` (same style as
 * daily-sheet/dto/correct-closed-trip.dto.ts). The note is persisted only in the
 * audit `after` block — there is no `Expense.correctionNote` column.
 */
export class CorrectClosedExpenseDto {
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  amount?: number;

  @IsOptional()
  @IsEnum(ExpenseCategory)
  category?: ExpenseCategory;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsBoolean()
  paidFromCash?: boolean;

  @IsOptional()
  @IsUUID()
  vanId?: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  correctionNote!: string;
}
