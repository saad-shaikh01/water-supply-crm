import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { DiscrepancyCaseStatus, DiscrepancyType } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class DiscrepancyCaseQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(DiscrepancyCaseStatus)
  status?: DiscrepancyCaseStatus;

  @IsOptional()
  @IsEnum(DiscrepancyType)
  type?: DiscrepancyType;

  @IsOptional()
  @IsUUID()
  driverId?: string;

  @IsOptional()
  @IsUUID()
  vanId?: string;

  @IsOptional()
  @IsUUID()
  dailySheetId?: string;

  @IsOptional()
  @IsString()
  dateFrom?: string;

  @IsOptional()
  @IsString()
  dateTo?: string;
}
