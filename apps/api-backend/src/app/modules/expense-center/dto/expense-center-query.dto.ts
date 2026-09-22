import { IsDateString, IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import {
  EXPENSE_CENTER_CATEGORY_VALUES,
  EXPENSE_CENTER_DOMAINS,
  EXPENSE_CENTER_SOURCE_BUCKETS,
  type ExpenseCenterDomain,
  type ExpenseCenterSourceBucket,
} from '../expense-center-domain.util';

// Spread into plain mutable arrays — class-validator's @IsIn takes a value
// array, and the exported constants are intentionally readonly.
const DOMAIN_VALUES: string[] = [...EXPENSE_CENTER_DOMAINS];
const CATEGORY_VALUES: string[] = [...EXPENSE_CENTER_CATEGORY_VALUES];
const SOURCE_BUCKET_VALUES: string[] = [...EXPENSE_CENTER_SOURCE_BUCKETS];

export class ExpenseCenterSummaryQueryDto {
  /** Inclusive start of the reporting range. Defaults with `to` to the current calendar month. */
  @IsOptional()
  @IsDateString()
  from?: string;

  /** Inclusive end of the reporting range (widened to end-of-day server-side). */
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class ExpenseCenterTimelineQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(DOMAIN_VALUES)
  domain?: ExpenseCenterDomain;

  /**
   * Raw ExpenseCategory | StaffLedgerCategory value (StaffLedgerCategory's
   * CREW_CASH resolves to the CrewCashDistribution + standalone crew cash
   * sources). Kept as a plain
   * string rather than one @IsEnum since it spans two Prisma enums.
   */
  @IsOptional()
  @IsIn(CATEGORY_VALUES)
  category?: string;

  @IsOptional()
  @IsUUID()
  vanId?: string;

  @IsOptional()
  @IsUUID()
  employeeId?: string;

  /** Extra Labour — an `ExtraLabour` id (distinct from `employeeId`, a `User` id). Expense-only. */
  @IsOptional()
  @IsUUID()
  extraLabourId?: string;

  /** Only narrows `Expense` rows — payroll-sourced rows are cash-only, so CARD excludes them. */
  @IsOptional()
  @IsIn(['CASH', 'CARD'])
  paymentMethod?: 'CASH' | 'CARD';

  /** Which recording surface to restrict to — Daily Sheet / Cash Ledger / Fleet / Payroll / Direct Expense. */
  @IsOptional()
  @IsIn(SOURCE_BUCKET_VALUES)
  source?: ExpenseCenterSourceBucket;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
