import { IsEnum, IsOptional, IsDateString, IsUUID } from 'class-validator';
import { ExpenseCategory } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class ExpenseQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(ExpenseCategory)
  category?: ExpenseCategory;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsUUID()
  vanId?: string;
}
