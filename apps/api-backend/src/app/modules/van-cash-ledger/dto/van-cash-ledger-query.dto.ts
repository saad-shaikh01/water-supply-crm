import { applyDecorators } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { BUCKET_RANK, type CashLedgerBucket } from '../cash-ledger-buckets';
import type { CashLedgerRemittanceDestination, CashLedgerStatusFilter } from '../cash-ledger-contract';

const BUCKET_VALUES = Object.keys(BUCKET_RANK) as CashLedgerBucket[];
const STATUS_VALUES: CashLedgerStatusFilter[] = ['PENDING', 'APPROVED', 'VOIDED', 'CORRECTED'];
const DESTINATION_VALUES: CashLedgerRemittanceDestination[] = ['OWNER', 'CEO', 'BANK', 'OTHER'];

/**
 * Query-string list -> `string[]`: `a`, `a,b`, `['a','b']` (repeated key) all work.
 * Blank entries are dropped and an empty result becomes `undefined` (= filter off).
 */
export function toStringArray(value: unknown): string[] | undefined {
  const parts = (Array.isArray(value) ? value : [value])
    .flatMap((item) => (typeof item === 'string' ? item.split(',') : []))
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return parts.length > 0 ? parts : undefined;
}

/**
 * Boolean query flag. Reads `obj[key]` — NOT `value` — because the global
 * ValidationPipe's `enableImplicitConversion` has already coerced `value` with
 * `Boolean('false') === true` by the time `@Transform` runs (see S46).
 * Only the literal `true` / `'true'` switches the filter on.
 */
const BooleanFlag = () =>
  Transform(({ obj, key }: { obj: Record<string, unknown>; key: string }) => {
    const raw = obj[key];
    if (raw === undefined || raw === null || raw === '') return undefined;
    return raw === true || raw === 'true';
  });

/** Optional list whose every entry must be one of `allowed`; tolerates a single value or a comma list. */
const EnumList = (allowed: readonly string[]) =>
  applyDecorators(
    IsOptional(),
    Transform(({ value }) => toStringArray(value)),
    IsArray(),
    IsIn(allowed, { each: true }),
  );

@ValidatorConstraint({ name: 'minAmountNotAboveMax', async: false })
class MinAmountNotAboveMax implements ValidatorConstraintInterface {
  validate(maxAmount: unknown, args: ValidationArguments): boolean {
    const { minAmount } = args.object as { minAmount?: unknown };
    if (typeof minAmount !== 'number' || typeof maxAmount !== 'number') return true;
    return minAmount <= maxAmount;
  }

  defaultMessage(): string {
    return 'minAmount cannot be greater than maxAmount';
  }
}

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

  // ── P3 entry filters (all optional; see cash-ledger-filters.ts) ────────────

  /** Free-text search; the server ignores it when the trimmed length is < 2. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @EnumList(BUCKET_VALUES)
  buckets?: CashLedgerBucket[];

  @EnumList(STATUS_VALUES)
  status?: CashLedgerStatusFilter[];

  // Express 5's default "simple" query parser (used by this app) does NOT fold
  // axios' `buckets[]=A&buckets[]=B` into `buckets` — the key arrives literally
  // as `buckets[]`. Accept those spellings too; `resolveTimelineFilters` merges
  // them into the canonical fields.
  @EnumList(BUCKET_VALUES)
  'buckets[]'?: CashLedgerBucket[];

  @EnumList(STATUS_VALUES)
  'status[]'?: CashLedgerStatusFilter[];

  /** Recorded (createdAt) window, PKT day, inclusive. */
  @IsOptional()
  @IsDateString()
  recordedFrom?: string;

  @IsOptional()
  @IsDateString()
  recordedTo?: string;

  @IsOptional()
  @BooleanFlag()
  @IsBoolean()
  backdatedOnly?: boolean;

  @IsOptional()
  @BooleanFlag()
  @IsBoolean()
  editedOnly?: boolean;

  @IsOptional()
  @BooleanFlag()
  @IsBoolean()
  hasAttachment?: boolean;

  @IsOptional()
  @BooleanFlag()
  @IsBoolean()
  hasNote?: boolean;

  @IsOptional()
  @IsUUID()
  recordedById?: string;

  @IsOptional()
  @IsUUID()
  approvedById?: string;

  /** Crew-cash / payroll employee OR the handover's submitting driver. */
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  /** Extra Labour — an `ExtraLabour` id (distinct from `employeeId`, a `User` id). OFFICE_EXPENSE rows only. */
  @IsOptional()
  @IsUUID()
  extraLabourId?: string;

  /** A `Vehicle` (Fleet) id — OFFICE_CASH_IN rows with source VEHICLE_RENTED_OUT only. */
  @IsOptional()
  @IsUUID()
  vehicleId?: string;

  @IsOptional()
  @Transform(({ value }) => toStringArray(value))
  @IsArray()
  @IsString({ each: true })
  categories?: string[];

  @IsOptional()
  @Transform(({ value }) => toStringArray(value))
  @IsArray()
  @IsString({ each: true })
  'categories[]'?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1_000_000_000_000)
  @Validate(MinAmountNotAboveMax)
  maxAmount?: number;

  /** Daily Sheet number — short-id prefix, case-insensitive, leading `#` tolerated. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  sheet?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;

  @IsOptional()
  @IsIn(DESTINATION_VALUES)
  destination?: CashLedgerRemittanceDestination;
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
