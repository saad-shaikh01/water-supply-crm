import { IsOptional, IsDateString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query for the per-vehicle daily meter-reading history (Fleet detail page,
 * "Meter Readings" tab). Paginates over the DailySheets this vehicle was
 * checked on, newest first, with an optional date-range filter.
 */
export class VehicleCheckHistoryQueryDto extends PaginationQueryDto {
  @IsOptional() @IsDateString() dateFrom?: string;
  @IsOptional() @IsDateString() dateTo?: string;
}
