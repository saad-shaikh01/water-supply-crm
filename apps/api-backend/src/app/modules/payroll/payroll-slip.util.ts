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
  /** Attendance category (e.g. "Sick") and free-text note, when the admin recorded them. */
  categoryName?: string | null;
  note?: string | null;
  waivedReason?: string | null;
}

export interface SlipAttendanceInput {
  decisionsApply: boolean;
  periodDayCount: number;
  presentDays: number;
  absentDays: number;
  halfDays: number;
  leaveDays: number;
  weeklyOffDays?: number;
  unmarkedDays?: number;
  days: SlipAttendanceDay[];
}

/** One non-present day printed in the slip's attendance table. */
export interface SlipAbsenceDay {
  date: Date;
  /** ABSENT | HALF_DAY | LEAVE */
  status: string;
  /** Plain-words outcome: "Unpaid - deducted", "Paid", "Not decided yet", ... */
  outcome: string;
  /** Rupees charged this period for the day (0 when none). */
  amount: number;
  note: string;
}

/** One ledger row behind the "Other deductions" total (crew cash, absence charge, manual deduction ...). */
export interface SlipDeductionItem {
  date: Date;
  /** Group heading, e.g. "Crew cash". */
  group: string;
  description: string;
  /** Signed rupees, as stored (negative = charged to the employee). */
  amount: number;
}

export interface SlipDeductionGroup {
  label: string;
  amount: number;
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
  /** Every absent / half-day / leave day with its outcome — empty for an employee with none. */
  days?: SlipAbsenceDay[];
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
  attendance: {
    presentDays: number;
    absentDays: number;
    halfDays: number;
    leaveDays: number;
    weeklyOffDays?: number;
    unmarkedDays?: number;
    periodDayCount: number;
  };
  /** Statement of the rows behind "Other deductions", oldest first. Omitted/empty = nothing to itemise. */
  deductions?: SlipDeductionItem[];
}

/**
 * The slip's money lines. Signs follow the ledger: deductions are already negative in the buckets, so the
 * lines sum to `finalPayable` with NO sign flipping:
 *   base + bonuses + overtime + incentives + expenses + advances + penalties + otherDeductions
 *   + carryForwardIn − deferredIn + deferredOut
 * (`deferredIn` = last period's held-back deduction charged now; `deferredOut` = this period's deduction held
 * back to next month — see `applyDeductionCeiling`).
 */
export function buildSlipLines(entry: SlipEntryInput, otherGroups: readonly SlipDeductionGroup[] = []): SlipLine[] {
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
  // Split the catch-all bucket into its real causes — only when the parts add up EXACTLY to the stored
  // bucket (a ledger change after the entry was computed must never print a slip that doesn't sum).
  const groupTotal = otherGroups.reduce((t, g) => t + g.amount, 0);
  if (otherGroups.length > 0 && groupTotal === entry.otherDeductions) {
    for (const g of otherGroups) add(g.label, g.amount);
  } else {
    add('Other deductions', entry.otherDeductions, 'Includes absence deductions, crew cash and other deductions.');
  }
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
    days: [],
  };
  for (const day of attendance.days) {
    const listed = describeAbsenceDay(day, attendance.decisionsApply);
    if (listed) out.days!.push(listed);
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

/** Plain-words outcome of one non-present day, or null for a day that needs no line (present / weekly off). */
function describeAbsenceDay(day: SlipAttendanceDay, decisionsApply: boolean): SlipAbsenceDay | null {
  if (day.status !== 'ABSENT' && day.status !== 'HALF_DAY' && day.status !== 'LEAVE') return null;
  let outcome: string;
  let amount = 0;
  if (day.status === 'LEAVE') outcome = 'Leave';
  else if (day.decision === 'DEDUCTED') {
    amount = day.deductedAmount ?? 0;
    outcome = day.deductionDeferred ? 'Unpaid - charged next month' : 'Unpaid - deducted';
  } else if (day.decision === 'WAIVED') outcome = 'Paid (not deducted)';
  else if (day.decision === 'PENDING') outcome = 'Not decided yet';
  else outcome = decisionsApply ? 'Not decided yet' : 'Unpaid - in base pay';
  const note = [day.categoryName, day.waivedReason ?? day.note].filter((x): x is string => !!x && !!x.trim()).join(' - ');
  return { date: day.date, status: day.status, outcome, amount, note };
}

export function buildSalarySlip(input: {
  vendorName: string;
  employee: { name: string; role: string };
  period: { periodLabel: string; startDate: Date; endDate: Date };
  entry: SlipEntryInput;
  attendance: SlipAttendanceInput;
  deductions?: SlipDeductionItem[];
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
    lines: buildSlipLines(entry, groupDeductions(input.deductions ?? [])),
    finalPayable: entry.finalPayable,
    absence: summarizeSlipAbsence(attendance),
    attendance: {
      presentDays: attendance.presentDays,
      absentDays: attendance.absentDays,
      halfDays: attendance.halfDays,
      leaveDays: attendance.leaveDays,
      weeklyOffDays: attendance.weeklyOffDays,
      unmarkedDays: attendance.unmarkedDays,
      periodDayCount: attendance.periodDayCount,
    },
    deductions: input.deductions ?? [],
  };
}

/** Sums the statement rows per group, keeping first-seen order. */
export function groupDeductions(items: readonly SlipDeductionItem[]): SlipDeductionGroup[] {
  const byLabel = new Map<string, number>();
  for (const i of items) byLabel.set(i.group, (byLabel.get(i.group) ?? 0) + i.amount);
  return [...byLabel].map(([label, amount]) => ({ label, amount }));
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
