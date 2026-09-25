import { ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsOptional, Max, Min, ValidateIf } from 'class-validator';
import { StaffLedgerCategory } from '@prisma/client';

/**
 * Every bucket-bearing ledger category is eligible for the cash-deduction
 * window — ADVANCE_DISBURSEMENT is the one exception (it never enters a
 * PayrollEntry bucket at all, see `bucketKeyForCategory` in
 * PayrollEntryService, so there is nothing for it to be redirected to a
 * different window).
 */
export const CASH_WINDOW_ELIGIBLE_CATEGORIES = Object.values(StaffLedgerCategory).filter(
  (category) => category !== StaffLedgerCategory.ADVANCE_DISBURSEMENT,
);

export class UpdatePayrollVendorConfigDto {
  /** Day-of-month the attendance/wage period starts — drives PayrollPeriod.startDate/endDate. */
  @IsInt()
  @Min(1)
  @Max(28) // never 29-31 — some months don't have that day; same reasoning as cashCutoffDay below
  cutoffDay: number;

  /**
   * Day-of-month the SEPARATE cash-deduction cycle starts, for whichever
   * categories are listed in `cashWindowCategories`. `null` disables the
   * dual-window feature entirely (every vendor's default).
   */
  @ValidateIf((o) => o.cashCutoffDay !== null)
  @IsInt()
  @Min(1)
  @Max(28)
  cashCutoffDay: number | null;

  @IsArray()
  @ArrayUnique()
  @IsIn(CASH_WINDOW_ELIGIBLE_CATEGORIES, { each: true })
  cashWindowCategories: StaffLedgerCategory[];

  @IsOptional()
  @IsBoolean()
  autoLockEnabled?: boolean;
}
