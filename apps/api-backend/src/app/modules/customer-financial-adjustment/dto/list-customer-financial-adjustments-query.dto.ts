import { IsDateString, IsIn, IsOptional, IsUUID } from 'class-validator';
import {
  ADJUSTMENT_KINDS,
  ADJUSTMENT_STATUSES,
  type AdjustmentKind,
  type AdjustmentStatus,
} from '@water-supply-crm/types';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Filters for GET /customer-financial-adjustments. Every parameter must be declared
 * here — the app's global ValidationPipe is `forbidNonWhitelisted`, so an undeclared
 * query param is a 400, not silently ignored. Unlike the create DTO, `kind` accepts
 * EVERY kind: a list must be able to show reversals (and, later, transfer legs).
 */
export class ListCustomerFinancialAdjustmentsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsIn(ADJUSTMENT_KINDS as readonly string[])
  kind?: AdjustmentKind;

  @IsOptional()
  @IsIn(ADJUSTMENT_STATUSES as readonly string[])
  status?: AdjustmentStatus;

  /** Inclusive lower bound on the business date (effectiveDate), by the vendor's calendar day. */
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  /** Inclusive upper bound on the business date (effectiveDate), by the vendor's calendar day. */
  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
