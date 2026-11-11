import { IsOptional, IsString, IsUUID, IsDateString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class AuditLogQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  entity?: string;

  @IsOptional()
  @IsString()
  entityId?: string;

  @IsOptional()
  @IsUUID()
  userId?: string;

  /** Honoured ONLY for SUPER_ADMIN (vendor admins are always pinned to their own vendor). */
  @IsOptional()
  @IsUUID()
  vendorId?: string;

  /** Comma-separated entity names, e.g. `Vendor,User,VendorBranding`. */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  entities?: string;

  @IsOptional()
  @IsString()
  action?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
