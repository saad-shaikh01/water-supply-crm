import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';


export class VendorUsersQueryDto extends PaginationQueryDto {
  /** Defaults to "everything except CUSTOMER". */
  @IsOptional()
  @IsIn(['VENDOR_ADMIN', 'STAFF', 'DRIVER', 'SALESMAN', 'LOADER', 'CUSTOMER'])
  role?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @Transform(({ value }) => (value === 'true' || value === true ? true : value === 'false' || value === false ? false : value))
  @IsBoolean()
  isActive?: boolean;
}
