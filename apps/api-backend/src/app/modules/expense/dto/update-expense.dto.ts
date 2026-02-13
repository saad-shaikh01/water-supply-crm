import {
  IsEnum,
  IsNumber,
  IsString,
  IsDateString,
  IsOptional,
  IsUUID,
  Min,
  MaxLength,
} from 'class-validator';
import { ExpenseCategory } from '@prisma/client';

export class UpdateExpenseDto {
  @IsOptional()
  @IsEnum(ExpenseCategory)
  category?: ExpenseCategory;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  amount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsUUID()
  vanId?: string;
}
