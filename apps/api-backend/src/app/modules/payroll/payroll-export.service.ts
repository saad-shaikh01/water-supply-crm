import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import type { AuthUser } from '@water-supply-crm/types';
import {
  csvInt,
  csvMoney,
  sanitizeFilenamePart,
  toCsv,
  type CsvExportResult,
  type CsvValue,
} from '../van-cash-ledger/cash-ledger-export.csv';
import { PayrollEntryService } from './payroll-entry.service';

export const PAYROLL_CSV_HEADERS = [
  'Period',
  'Employee',
  'Role',
  'Base Salary',
  'Bonuses',
  'Overtime',
  'Incentives',
  'Advances',
  'Expenses',
  'Penalties',
  'Other Deductions',
  'Carry Forward In',
  'Deferred In',
  'Deferred Out',
  'Final Payable',
  'Status',
  'Settled Amount',
  'Balance',
  'Pending Absence Days',
] as const;

/** One `listForPeriod` row — only the fields the export reads. */
export interface PayrollCsvRow {
  user: { name: string; role: string };
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
  settledAmount?: number;
  pendingAbsenceDays?: number;
}

/**
 * Pure: one CSV row per employee. Text cells (name, role, status) go through the shared
 * formula-neutraliser; every amount is a numeric cell, so a negative balance stays a number.
 * Balance = finalPayable − settledAmount (negative when over-settled).
 */
export function buildPayrollCsv(periodLabel: string, rows: readonly PayrollCsvRow[]): string {
  const body: CsvValue[][] = rows.map((r) => {
    const settled = r.settledAmount ?? 0;
    return [
      periodLabel,
      r.user.name,
      r.user.role,
      csvMoney(r.baseSalary),
      csvMoney(r.bonuses),
      csvMoney(r.overtime),
      csvMoney(r.incentives),
      csvMoney(r.advances),
      csvMoney(r.expenses),
      csvMoney(r.penalties),
      csvMoney(r.otherDeductions),
      csvMoney(r.carryForwardIn),
      csvMoney(r.deferredIn),
      csvMoney(r.deferredOut),
      csvMoney(r.finalPayable),
      r.status,
      csvMoney(settled),
      csvMoney(r.finalPayable - settled),
      csvInt(r.pendingAbsenceDays ?? 0),
    ];
  });
  return toCsv(PAYROLL_CSV_HEADERS, body);
}

/** Monthly Payroll → "Export CSV". Reads through `PayrollEntryService.listForPeriod` (no second query path). */
@Injectable()
export class PayrollExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payrollEntries: PayrollEntryService,
  ) {}

  async exportPeriodCsv(user: AuthUser, periodId: string): Promise<CsvExportResult> {
    const period = await this.prisma.payrollPeriod.findFirst({
      where: { id: periodId, vendorId: user.vendorId },
      select: { periodLabel: true },
    });
    if (!period) throw new NotFoundException('Payroll period not found.');

    // listForPeriod is itself vendor-scoped; it also works for LOCKED / PAID (historical) periods.
    const rows = await this.payrollEntries.listForPeriod(user, periodId);
    const label = sanitizeFilenamePart(period.periodLabel) || 'period';
    return {
      filename: `payroll-${label}.csv`,
      body: buildPayrollCsv(period.periodLabel, rows as readonly PayrollCsvRow[]),
      truncated: false,
    };
  }
}
