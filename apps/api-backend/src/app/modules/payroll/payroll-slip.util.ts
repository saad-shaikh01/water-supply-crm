import { normalizePhone, isSendablePhone } from '../whatsapp/phone.util';

/**
 * Salary-slip helpers — PURE (no DB, no Nest). Shared by the send service (eligibility), the
 * processor / PDF (slip content) and the specs.
 */

/** A slip is only sent once the employee's final payable is settled on: APPROVED, LOCKED or SETTLED. */
export const SLIP_ELIGIBLE_STATUSES = ['APPROVED', 'LOCKED', 'SETTLED'] as const;

export type SlipVerdict = 'ELIGIBLE' | 'NOT_FINAL' | 'NO_PHONE';

/** Human reason shown next to a disabled "Send slip" button. */
export const SLIP_VERDICT_REASON: Record<Exclude<SlipVerdict, 'ELIGIBLE'>, string> = {
  NOT_FINAL: 'Final payable is not set yet — approve this entry first.',
  NO_PHONE: 'Employee has no valid WhatsApp number.',
};

export function isSlipEligibleStatus(status: string): boolean {
  return (SLIP_ELIGIBLE_STATUSES as readonly string[]).includes(status);
}

/** NOT_FINAL wins over NO_PHONE: an entry that is not final is not sendable whatever its phone says. */
export function classifySlipEntry(entry: { status: string }, rawPhone: string | null | undefined): SlipVerdict {
  if (!isSlipEligibleStatus(entry.status)) return 'NOT_FINAL';
  if (!isSendablePhone(rawPhone)) return 'NO_PHONE';
  return 'ELIGIBLE';
}

export { normalizePhone };

// ── Slip content ─────────────────────────────────────────────────────────────

export interface SlipEntryInput {
  baseSalary: number;
  bonuses: number;
  overtime: number;
  incentives: number;
  advances: number;
  expenses: number;
  penalties: number;
  otherDeductions: number;
  carryForwardIn: number;
  deferredIn: number;
  deferredOut: number;
  finalPayable: number;
  status: string;
}

export interface SlipAttendanceDay {
  date: Date;
  status: string;
  decision: 'DEDUCTED' | 'WAIVED' | 'PENDING' | null;
  deductedAmount?: number;
  deductionDeferred?: boolean;
}

export interface SlipAttendanceInput {
  decisionsApply: boolean;
  periodDayCount: number;
  presentDays: number;
  absentDays: number;
  halfDays: number;
  leaveDays: number;
  days: SlipAttendanceDay[];
}

export interface SlipLine {
  label: string;
  /** Signed rupees: positive adds to pay, negative reduces it. */
  amount: number;
  /** Short explanation printed under the line (optional). */
  note?: string;
}

export interface SlipAbsence {
  /** MONTHLY employees get a per-day decision; DAILY/WEEKLY base is already attendance-derived. */
  decisionsApply: boolean;
  absentDays: number;
  halfDays: number;
  deductedDays: number;
  deductedAmount: number;
  /** Deducted days whose money is charged NEXT month ("deduct next month") — not in this slip's total. */
  deferredDays: number;
  deferredAmount: number;
  waivedDays: number;
  pendingDays: number;
}

export interface SalarySlipData {
  vendorName: string;
  employeeName: string;
  role: string;
  periodLabel: string;
  periodStart: Date;
  periodEnd: Date;
  status: string;
  lines: SlipLine[];
  finalPayable: number;
  absence: SlipAbsence;
  attendance: { presentDays: number; absentDays: number; halfDays: number; leaveDays: number; periodDayCount: number };
}

/**
 * The slip's money lines. Signs follow the ledger: deductions are already negative in the buckets, so the
 * lines sum to `finalPayable` with NO sign flipping:
 *   base + bonuses + overtime + incentives + expenses + advances + penalties + otherDeductions
 *   + carryForwardIn − deferredIn + deferredOut
 * (`deferredIn` = last period's held-back deduction charged now; `deferredOut` = this period's deduction held
 * back to next month — see `applyDeductionCeiling`).
 */
export function buildSlipLines(entry: SlipEntryInput): SlipLine[] {
  const lines: SlipLine[] = [{ label: 'Base salary', amount: entry.baseSalary }];
  const add = (label: string, amount: number, note?: string, always = false) => {
    if (amount !== 0 || always) lines.push({ label, amount, ...(note ? { note } : {}) });
  };
  add('Bonuses', entry.bonuses);
  add('Overtime', entry.overtime);
  add('Incentives', entry.incentives);
  add('Expense reimbursements', entry.expenses);
  add('Advances', entry.advances);
  add('Penalties', entry.penalties);
  add('Other deductions', entry.otherDeductions, 'Includes absence deductions, crew cash and other deductions.');
  add('Carried forward from previous month', entry.carryForwardIn);
  add('Held-back deductions from previous month', -entry.deferredIn, 'Deductions held back last month, charged now.');
  add('Deductions held back to next month', entry.deferredOut, 'Not deducted this month (deduction limit) — will be charged next month.');
  return lines;
}

export function sumSlipLines(lines: readonly SlipLine[]): number {
  return lines.reduce((total, l) => total + l.amount, 0);
}

export function summarizeSlipAbsence(attendance: SlipAttendanceInput): SlipAbsence {
  const out: SlipAbsence = {
    decisionsApply: attendance.decisionsApply,
    absentDays: attendance.absentDays,
    halfDays: attendance.halfDays,
    deductedDays: 0,
    deductedAmount: 0,
    deferredDays: 0,
    deferredAmount: 0,
    waivedDays: 0,
    pendingDays: 0,
  };
  for (const day of attendance.days) {
    if (day.decision === 'DEDUCTED') {
      if (day.deductionDeferred) {
        out.deferredDays++;
        out.deferredAmount += day.deductedAmount ?? 0;
      } else {
        out.deductedDays++;
        out.deductedAmount += day.deductedAmount ?? 0;
      }
    } else if (day.decision === 'WAIVED') out.waivedDays++;
    else if (day.decision === 'PENDING') out.pendingDays++;
  }
  return out;
}

export function buildSalarySlip(input: {
  vendorName: string;
  employee: { name: string; role: string };
  period: { periodLabel: string; startDate: Date; endDate: Date };
  entry: SlipEntryInput;
  attendance: SlipAttendanceInput;
}): SalarySlipData {
  const { entry, attendance } = input;
  return {
    vendorName: input.vendorName,
    employeeName: input.employee.name,
    role: input.employee.role,
    periodLabel: input.period.periodLabel,
    periodStart: input.period.startDate,
    periodEnd: input.period.endDate,
    status: entry.status,
    lines: buildSlipLines(entry),
    finalPayable: entry.finalPayable,
    absence: summarizeSlipAbsence(attendance),
    attendance: {
      presentDays: attendance.presentDays,
      absentDays: attendance.absentDays,
      halfDays: attendance.halfDays,
      leaveDays: attendance.leaveDays,
      periodDayCount: attendance.periodDayCount,
    },
  };
}

/** `45000` → `45,000` (no currency prefix) — the `{{3}}` template variable and the PDF amounts. */
export function formatRupees(amount: number): string {
  return Math.round(amount).toLocaleString('en-US');
}

/** Safe fragment for a file name (`Ali Raza` → `Ali-Raza`). */
export function slipFilename(employeeName: string, periodLabel: string): string {
  const part = (employeeName ?? '').trim().replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'Employee';
  const label = (periodLabel ?? '').replace(/[^A-Za-z0-9-]+/g, '-') || 'period';
  return `Salary-Slip-${label}-${part}.pdf`;
}
