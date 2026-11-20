import { IsBoolean, IsOptional } from 'class-validator';
import { NotificationLogQueryDto } from './notification-log-query.dto';

/** "Retry all failed" — the log page's current filters, plus whether to include failures from before they were classified. */
export class BulkRetryDto extends NotificationLogQueryDto {
  /**
   * Failures logged before the retry-safety classification existed cannot be PROVEN undelivered. Off by default;
   * the UI asks the user to confirm before turning it on.
   */
  @IsOptional()
  @IsBoolean()
  includeLegacy?: boolean;
}
