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
  @IsString()
  dateFrom?: string;

  @IsOptional()
  @IsString()
  dateTo?: string;
}
