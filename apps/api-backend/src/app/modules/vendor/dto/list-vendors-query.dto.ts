import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export const VENDOR_STATUS_FILTERS = ['all', 'active', 'suspended', 'live', 'not_live'] as const;
export const VENDOR_SORTS = ['createdAt', 'name', 'customers'] as const;

export class ListVendorsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsIn(VENDOR_STATUS_FILTERS)
  status?: (typeof VENDOR_STATUS_FILTERS)[number] = 'all';

  @IsOptional()
  @IsIn(VENDOR_SORTS)
  sort?: (typeof VENDOR_SORTS)[number] = 'createdAt';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc' = 'desc';
}
