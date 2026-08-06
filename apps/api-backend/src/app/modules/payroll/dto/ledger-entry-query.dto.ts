import { IsDateString, IsEnum, IsOptional } from 'class-validator';
import { LedgerEntryStatus, StaffLedgerCategory } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class LedgerEntryQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(StaffLedgerCategory)
  category?: StaffLedgerCategory;

  @IsOptional()
  @IsEnum(LedgerEntryStatus)
  status?: LedgerEntryStatus;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
