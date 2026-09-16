import { IsOptional, IsString, IsUUID, IsIn, IsEnum, IsNumber, IsBoolean, IsInt, Min, Max } from 'class-validator';
import { Transform } from 'class-transformer';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { PaymentType } from '@prisma/client';

export class CustomerQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsUUID()
  routeId?: string;

  @IsOptional()
  @IsEnum(PaymentType)
  paymentType?: PaymentType;

  @IsOptional()
  @IsUUID()
  vanId?: string;

  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek?: number;

  // Reads `obj` (the raw query value), not `value` — the global ValidationPipe's
  // `enableImplicitConversion` runs first for a `boolean`-typed field and coerces ANY
  // non-empty string (including 'false') to `true` via `Boolean(value)` before this
  // `@Transform` ran, which made 'false' silently resolve to `true` here.
  @IsOptional()
  @Transform(({ obj }) => obj.isActive === 'true' || obj.isActive === true)
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @Transform(({ obj }) => obj.hasPortalAccess === 'true' || obj.hasPortalAccess === true)
  @IsBoolean()
  hasPortalAccess?: boolean;

  @IsOptional()
  @Transform(({ value }) => parseFloat(value))
  @IsNumber()
  @Min(0)
  balanceMin?: number;

  @IsOptional()
  @Transform(({ value }) => parseFloat(value))
  @IsNumber()
  @Min(0)
  balanceMax?: number;

  /**
   * Only return customers with NO successful delivery (COMPLETED / EMPTY_ONLY)
   * in the last N days — i.e. customers whose last delivery is older than N days
   * ago, plus customers who have never received a delivery.
   */
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  @Max(3650)
  notDeliveredInDays?: number;

  /**
   * Only return customers with NO payment (PAYMENT transaction) recorded in
   * the last N days — covers both cash collected during a delivery and
   * payments logged via "Record Payment". Customers who have never paid are
   * included too (they trivially satisfy `none`).
   */
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  @Max(3650)
  notPaidInDays?: number;

  @IsOptional()
  @IsIn(['name', 'customerCode', 'createdAt', 'financialBalance', 'bottleBalance', 'pendingAmount'])
  sort?: string = 'name';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDir?: 'asc' | 'desc' = 'asc';
}
