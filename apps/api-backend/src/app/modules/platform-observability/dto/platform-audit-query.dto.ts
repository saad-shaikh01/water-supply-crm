import { IsDateString, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class PlatformAuditQueryDto extends PaginationQueryDto {
  @IsOptional() @IsUUID() vendorId?: string;
  @IsOptional() @IsUUID() userId?: string;
  @IsOptional() @IsString() @MaxLength(100) action?: string;
  @IsOptional() @IsString() @MaxLength(100) entity?: string;
  @IsOptional() @IsString() @MaxLength(100) entityId?: string;
  /** Case-insensitive contains on the user name snapshot. */
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}
