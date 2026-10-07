import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';

export class ApprovePayrollEntryDto {
  /** Optimistic-concurrency token — must match the entry's current `version`. */
  @IsInt()
  @Min(0)
  version: number;

  /**
   * Approve even though some ABSENT / HALF_DAY days have no paid/unpaid decision yet
   * (they will be paid in full). Without it, approval of such an entry is refused with
   * code PENDING_ABSENCE_DECISIONS so the admin has to knowingly accept that. Ignored
   * by `recalculate`, which shares this DTO.
   */
  @IsOptional()
  @IsBoolean()
  acknowledgePendingAbsences?: boolean;
}
