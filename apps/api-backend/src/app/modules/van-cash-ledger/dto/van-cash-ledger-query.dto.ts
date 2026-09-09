import { IsDateString, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class VanCashLedgerTimelineQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  vanId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

export class VanCashLedgerStatsQueryDto {
  @IsOptional()
  @IsUUID()
  vanId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

export class VanCashLedgerPendingQueryDto {
  @IsOptional()
  @IsUUID()
  vanId?: string;
}
