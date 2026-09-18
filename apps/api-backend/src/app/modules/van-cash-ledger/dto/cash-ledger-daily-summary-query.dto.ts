import { Transform } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsOptional, IsUUID } from 'class-validator';
import type { CashLedgerSummaryGroup } from '../cash-ledger-contract';

/**
 * GET /van-cash-ledger/daily-summary. Entry filters (type / source / search …)
 * are deliberately NOT accepted — the table always shows the true date + van
 * scope statements.
 */
export class CashLedgerDailySummaryQueryDto {
  @IsOptional()
  @IsUUID()
  vanId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsIn(['day', 'week', 'month'])
  group?: CashLedgerSummaryGroup = 'day';

  // Reads `obj` (the raw query value), not `value` — the global ValidationPipe's
  // `enableImplicitConversion` coerces ANY non-empty string (including 'false') to
  // `true` for a `boolean`-typed field before this `@Transform` runs (S46 bug).
  @IsOptional()
  @Transform(({ obj }) => obj.includeEmpty === 'true' || obj.includeEmpty === true)
  @IsBoolean()
  includeEmpty?: boolean;
}
