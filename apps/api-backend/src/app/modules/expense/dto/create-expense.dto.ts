import {
  IsEnum,
  IsNumber,
  IsString,
  IsDateString,
  IsOptional,
  IsUUID,
  IsBoolean,
  Min,
  MaxLength,
} from 'class-validator';
import { ExpenseCategory } from '@prisma/client';

export class CreateExpenseDto {
  @IsEnum(ExpenseCategory)
  category: ExpenseCategory;

  @IsNumber()
  @Min(0.01)
  amount: number;

  // Whether this amount came out of the driver's van cash-in-hand (default
  // true). Set false when paid by card/bank/company account — that spend
  // must not reduce the driver's cash hand-in on the sheet.
  @IsOptional()
  @IsBoolean()
  paidFromCash?: boolean;

  @IsString()
  @MaxLength(500)
  description: string;

  @IsDateString()
  date: string;

  @IsOptional()
  @IsUUID()
  vanId?: string;

  @IsOptional()
  @IsUUID()
  dailySheetId?: string;
}
