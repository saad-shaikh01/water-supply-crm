import { IsString, IsNumber, IsOptional, Min, Max, IsInt, IsBoolean, IsIn, IsArray, ArrayMinSize, Matches } from 'class-validator';

/**
 * Which flavour of message to send.
 *  'reminder'       — balance reminder / monthly statement (default; unchanged behaviour)
 *  'statement_only' — pure monthly statement: no payment ask, no balance threshold,
 *                     PDF always attached, sent regardless of balance
 *  'warning'        — post-statement overdue-balance warning (text only). Targets only
 *                     customers already sent a statement this cycle who still owe.
 */
export type SendKind = 'reminder' | 'statement_only' | 'warning';

const SEND_KINDS: SendKind[] = ['reminder', 'statement_only', 'warning'];

export class SendNowDto {
  @IsOptional()
  @IsIn(SEND_KINDS)
  sendKind?: SendKind;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minBalance?: number;

  /** If true, list who would receive messages without actually sending */
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  /**
   * Billing month to reference in the reminder (YYYY-MM).
   * Defaults to the current calendar month.
   */
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month must be in YYYY-MM format' })
  month?: string;

  /**
   * If true, generate the monthly statement PDF for each customer,
   * upload it to private storage, and include the signed URL in the message.
   */
  @IsOptional()
  @IsBoolean()
  includeStatement?: boolean;

  /**
   * Restrict reminders to a specific payment type.
   * 'MONTHLY' — only monthly subscribers
   * 'CASH'    — only cash customers
   * Omit (or undefined) — send to both types
   */
  @IsOptional()
  @IsIn(['MONTHLY', 'CASH'])
  paymentType?: 'MONTHLY' | 'CASH';

  /** Restrict to customers assigned to this van (via delivery schedule) */
  @IsOptional()
  @IsString()
  vanId?: string;

  /** Restrict to customers with a delivery on this weekday (1=Mon … 6=Sat) */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(6)
  dayOfWeek?: number;

  /** Customer IDs manually excluded from this send (hand-picked in preview) */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  excludeCustomerIds?: string[];
}

export class PreviewDto {
  @IsOptional()
  @IsIn(SEND_KINDS)
  sendKind?: SendKind;

  /**
   * 'eligible' scans all vendor customers and classifies each.
   * 'selected'/'single' scans only the provided customerIds.
   * Defaults to 'eligible'.
   */
  @IsOptional()
  @IsIn(['single', 'selected', 'eligible'])
  mode?: 'single' | 'selected' | 'eligible';

  /** Explicit customer IDs for mode=single or mode=selected */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  customerIds?: string[];

  /** Balance threshold — only relevant for mode=eligible */
  @IsOptional()
  @IsNumber()
  @Min(0)
  minBalance?: number;

  /** Billing month reference (YYYY-MM). Defaults to current month. */
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month must be in YYYY-MM format' })
  month?: string;

  /** If true, statement links would be included in the message. */
  @IsOptional()
  @IsBoolean()
  includeStatement?: boolean;

  /**
   * Restrict preview to a specific payment type.
   * Omit to include both MONTHLY and CASH customers.
   */
  @IsOptional()
  @IsIn(['MONTHLY', 'CASH'])
  paymentType?: 'MONTHLY' | 'CASH';

  /** Restrict to customers assigned to this van (via delivery schedule) */
  @IsOptional()
  @IsString()
  vanId?: string;

  /** Restrict to customers with a delivery on this weekday (1=Mon … 6=Sat) */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(6)
  dayOfWeek?: number;
}

// (PreviewDto needs no excludeCustomerIds — exclusion is picked client-side from preview results)

export class SendTargetedDto {
  @IsOptional()
  @IsIn(SEND_KINDS)
  sendKind?: SendKind;

  /**
   * Send mode:
   *   single   — send to exactly one customer (customerIds must have exactly one entry)
   *   selected — send to the specified list of customers (customerIds required)
   *   eligible — send to all eligible customers above minBalance threshold
   */
  @IsIn(['single', 'selected', 'eligible'])
  mode: 'single' | 'selected' | 'eligible';

  /**
   * Required when mode is 'single' or 'selected'.
   * For 'eligible' mode this is ignored.
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  customerIds?: string[];

  /** Minimum outstanding balance threshold — applies to 'eligible' mode */
  @IsOptional()
  @IsNumber()
  @Min(0)
  minBalance?: number;

  /** If true, preview recipients without sending */
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  /**
   * If true, bypass cooldown protection and send regardless of recent delivery.
   * Useful for manual overrides (will be enforced once BR-BE-008 is implemented).
   */
  @IsOptional()
  @IsBoolean()
  force?: boolean;

  /**
   * Billing month to reference in the reminder (YYYY-MM).
   * Defaults to the current calendar month.
   */
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month must be in YYYY-MM format' })
  month?: string;

  /**
   * If true, generate the monthly statement PDF for each customer,
   * upload it to private storage, and include the signed URL in the message.
   */
  @IsOptional()
  @IsBoolean()
  includeStatement?: boolean;

  /**
   * Restrict reminders to a specific payment type.
   * 'MONTHLY' — only monthly subscribers
   * 'CASH'    — only cash customers
   * Omit (or undefined) — send to both types
   */
  @IsOptional()
  @IsIn(['MONTHLY', 'CASH'])
  paymentType?: 'MONTHLY' | 'CASH';

  /** Restrict to customers assigned to this van (via delivery schedule) */
  @IsOptional()
  @IsString()
  vanId?: string;

  /** Restrict to customers with a delivery on this weekday (1=Mon … 6=Sat) */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(6)
  dayOfWeek?: number;

  /** Customer IDs manually excluded from this send (hand-picked in preview) */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  excludeCustomerIds?: string[];
}

/** PUT /balance-reminders/config — overdue-warning knobs. */
export class UpdateBalanceReminderConfigDto {
  /** Days after a statement send before a warning may be sent (1–14). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(14)
  warningDelayDays?: number;

  /** Live outstanding balance at/above which a warning applies. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  warningMinBalance?: number;
}
