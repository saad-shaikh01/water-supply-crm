import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { DeliveryIssueStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class DeliveryIssueQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(DeliveryIssueStatus)
  status?: DeliveryIssueStatus;

  @IsOptional()
  @IsUUID()
  sheetId?: string;

  @IsOptional()
  @IsUUID()
  assignedToUserId?: string;

  /** Filters on the ORIGIN van (dailySheetItem.dailySheet.vanId) — the van whose
   * route the delivery actually missed on, not the (optional) planned retry van. */
  @IsOptional()
  @IsUUID()
  vanId?: string;

  @IsOptional()
  @IsString()
  dateFrom?: string;

  @IsOptional()
  @IsString()
  dateTo?: string;
}
