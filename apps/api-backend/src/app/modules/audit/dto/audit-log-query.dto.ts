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

  @IsOptional()
  @IsString()
  action?: string;

  /**
   * Everything that touched this customer: rows on the Customer itself plus
   * rows on related records (deposits, adjustments, prices…) whose payload
   * references the customer.
   */
  @IsOptional()
  @IsUUID()
  customerId?: string;

  /** Free text across user name, action, entity and entity id. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
