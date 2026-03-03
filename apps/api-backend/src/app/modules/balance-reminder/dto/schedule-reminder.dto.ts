import { IsString, IsNumber, IsOptional, Min, IsBoolean, IsIn, IsArray, ArrayMinSize } from 'class-validator';

export class ScheduleReminderDto {
  /**
   * Cron expression (UTC) for when to send reminders.
   * Default: '0 4 * * *' = 9 AM Pakistan Time (PKT is UTC+5)
   * Examples:
   *   '0 4 * * *'  - daily at 9 AM PKT
   *   '0 4 * * 1'  - every Monday at 9 AM PKT
   */
  @IsOptional()
  @IsString()
  cronExpression?: string;

  /**
   * Minimum outstanding balance (Rs) to trigger a reminder.
   * Customers with financialBalance >= minBalance will receive a message.
   * Default: 100
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  minBalance?: number;
}

export class SendNowDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  minBalance?: number;

  /** If true, list who would receive messages without actually sending */
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}

export class PreviewDto {
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
}

export class SendTargetedDto {
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
}
