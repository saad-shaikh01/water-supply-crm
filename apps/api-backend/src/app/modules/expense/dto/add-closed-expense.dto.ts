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
 * Post-Close Expense Correction — add a missed Expense row onto an ALREADY-CLOSED
 * daily sheet, via `POST /expenses/closed` (the ordinary `POST /expenses` refuses
 * a closed-sheet `dailySheetId`).
 *
 * Mirrors `CreateExpenseDto`, but `dailySheetId` is REQUIRED (this action only
 * ever targets a specific closed sheet) and a mandatory `correctionNote` is
 * added. The note is persisted only in the audit `after` block.
 */
export class AddClosedExpenseDto {
  @IsEnum(ExpenseCategory)
  category!: ExpenseCategory;

  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @IsBoolean()
  paidFromCash?: boolean;

  @IsString()
  @MaxLength(500)
  description!: string;

  @IsDateString()
  date!: string;

  @IsOptional()
  @IsUUID()
  vanId?: string;

  @IsUUID()
  dailySheetId!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  correctionNote!: string;
}
