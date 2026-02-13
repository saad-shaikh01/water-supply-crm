import { IsString, IsNumber, IsOptional, Min, IsBoolean } from 'class-validator';

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
