import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, MinLength } from 'class-validator';
import { StaffLedgerCategory } from '@prisma/client';

/**
 * Linked Penalty (owner-approved 2026-09-25) — categories a staff-vs-customer
 * link makes sense for: a customer wasn't credited money they're owed because
 * of a STAFF error, so the same amount is debited from that staff member's pay.
 * A bonus/advance/reimbursement etc. never has this shape.
 */
export const LINKABLE_PENALTY_CATEGORIES: StaffLedgerCategory[] = [
  StaffLedgerCategory.PENALTY,
  StaffLedgerCategory.DEDUCTION,
];

/**
 * `POST /payroll/ledger-entries/linked-penalty` — atomically posts a
 * `StaffLedgerEntry` debit against `userId` AND a `STAFF_FAULT_CREDIT`
 * `CustomerFinancialAdjustment` crediting `customerId` the SAME amount (e.g.
 * a driver never recorded a customer's cash payment). See
 * `LinkedPenaltyService.createLinkedPenalty`.
 */
export class CreateLinkedPenaltyDto {
  @IsUUID()
  userId: string;

  @IsIn(LINKABLE_PENALTY_CATEGORIES)
  category: StaffLedgerCategory;

  /**
   * Whole rupees, always negative (a debit against the employee) — the
   * customer is credited `Math.abs(amount)`, the exact same figure.
   */
  @IsInt()
  @Max(-1)
  amount: number;

  @IsDateString()
  effectiveDate: string;

  /** Staff-only note on the employee's ledger entry. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsUUID()
  customerId: string;

  /** Customer-facing title for the credit — shown on their statement/portal (ITEMIZED). */
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  customerCreditTitle: string;
}
