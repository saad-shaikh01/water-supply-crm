import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { DamageCaseStatus, DamageSeverity } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class DamageCaseQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(DamageCaseStatus)
  status?: DamageCaseStatus;

  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsUUID()
  driverId?: string;

  @IsOptional()
  @IsUUID()
  vanId?: string;

  @IsOptional()
  @IsEnum(DamageSeverity)
  severity?: DamageSeverity;

  @IsOptional()
  @IsString()
  dateFrom?: string;

  @IsOptional()
  @IsString()
  dateTo?: string;
}
