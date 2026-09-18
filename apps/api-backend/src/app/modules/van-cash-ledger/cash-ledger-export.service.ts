import { Injectable } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { vendorDateString, vendorDayStart } from '../../common/helpers/date.util';
import { shortSheetId } from '../expense-center/expense-center-domain.util';
import type { CashLedgerBucket } from './cash-ledger-buckets';
import type { CashLedgerDailySummary, CashLedgerDirection, CashLedgerSummaryGroup } from './cash-ledger-contract';
import {
  csvInt,
  csvMoney,
  formatPktDate,
  formatPktDateTime,
  sanitizeFilenamePart,
  toCsv,
  type CsvExportResult,
  type CsvValue,
} from './cash-ledger-export.csv';
import { pktDay } from './cash-ledger-sort';
import { CashLedgerDailySummaryQueryDto } from './dto/cash-ledger-daily-summary-query.dto';
import { VanCashLedgerTimelineQueryDto } from './dto/van-cash-ledger-query.dto';
import { VanCashLedgerService, type VanCashLedgerRow } from './van-cash-ledger.service';

/** Rows fetched per `getTimeline` call while paging through the export. */
export const EXPORT_PAGE_SIZE = 500;
/** Hard cap on exported ledger rows — beyond it the OLDEST rows are dropped and `truncated` is set. */
export const EXPORT_ROW_CAP = 50_000;

export const TIMELINE_CSV_HEADERS = [
  'Business Date',
  'Recorded At (PKT)',
  'Days Late',
  'For Date',
  'Flow',
  'Category',
  'Title',
  'Van',
  'Employee',
  'Recorded By',
  'Approved By',
  'Reference',
  'Notes',
  'Status',
  'Amount',
  'Balance After',
  'Sheet #',
  'Expected (Sheet)',
  'Variance',
  'Edited',
  'Voided Reason',
  'Closed Period',
] as const;

export const DAILY_CSV_HEADERS = [
  'Period',
  'From',
  'To',
  'Opening Cash',
  'Sheet Cash In',
  'Office Cash In',
  'Total Cash In',
  'Available Cash',
  'Office Expenses',
  'Payroll Cash',
  'Crew Cash',
  'Total Expenses',
  'Owner Transfer',
  'Fuel Card',
  'Net Cash',
  'Expected Closing Cash',
  'Entries',
  'Late Entries',
  'Pending',
] as const;

/** The CSV "Category" column — the human label of each cash-ledger bucket. */
export const BUCKET_CSV_LABEL: Record<CashLedgerBucket, string> = {
  SHEET_CASH_IN: 'Sheet Cash In',
  OFFICE_CASH_IN: 'Office Cash In',
  OFFICE_EXPENSE: 'Office Expense',
  PAYROLL_CASH: 'Payroll Cash',
  CREW_CASH: 'Crew Cash',
  OWNER_TRANSFER: 'Owner Transfer',
  FUEL_CARD: 'Fuel Card',
};

const FLOW_LABEL: Record<CashLedgerDirection, string> = { IN: 'In', OUT: 'Out', TRANSFER: 'Transfer' };

const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

const isHandoverFamily = (row: Pick<VanCashLedgerRow, 'type'>): boolean =>
  row.type === 'CASH_IN' || row.type === 'CASH_IN_CORRECTION';

/** Pending / Approved / Voided / Correction — Voided wins, then Pending, then Correction. */
export function csvRowStatus(
  row: Pick<VanCashLedgerRow, 'type' | 'status' | 'isVoided' | 'isCorrection'>,
): 'Pending' | 'Approved' | 'Voided' | 'Correction' {
  if (row.isVoided || (row.status as string | null) === 'VOIDED') return 'Voided';
  if (row.status === 'PENDING') return 'Pending';
  if (row.type === 'CASH_IN_CORRECTION' || row.isCorrection) return 'Correction';
  return 'Approved';
}

/** One ledger entry -> one CSV row (order = `TIMELINE_CSV_HEADERS`). */
export function timelineCsvRow(row: VanCashLedgerRow): CsvValue[] {
  const status = csvRowStatus(row);
  const voided = status === 'Voided';
  const handover = isHandoverFamily(row);
  return [
    pktDay(row.date),
    formatPktDateTime(row.createdAt),
    row.lagDays ? csvInt(row.lagDays) : null,
    row.relatesToDate ? pktDay(row.relatesToDate) : null,
    FLOW_LABEL[row.direction] ?? '',
    BUCKET_CSV_LABEL[row.bucket] ?? row.bucket,
    row.title,
    row.vanPlateNumber,
    row.employeeName ?? (handover ? row.submittedByName : null),
    row.recordedByName,
    row.approvedByName,
    row.reference,
    row.notes,
    status,
    // Voided (and PENDING memo) rows already carry amount 0 — enforce it for voided regardless.
    csvMoney(voided ? 0 : row.amount),
    csvMoney(row.runningBalance),
    row.dailySheetId ? shortSheetId(row.dailySheetId) : null,
    handover ? csvMoney(row.expectedAmount) : null,
    handover ? csvMoney(row.variance) : null,
    row.isEdited ? 'Yes' : null,
    voided ? row.voidReason : null,
    row.periodClosed ? 'Yes' : null,
  ];
}

/** Bare `YYYY-MM-DD` or ISO timestamp -> the PKT day it refers to; `all` when absent. */
function rangeDay(input: string | null | undefined): string {
  if (!input) return 'all';
  return vendorDateString(vendorDayStart(input));
}

/** `cash-ledger-<from>_to_<to>[_van-<plate>].csv` (timeline) / `cash-ledger-<daily|weekly|monthly>-…` (summary). */
export function buildExportFilename(input: {
  kind: 'timeline' | CashLedgerSummaryGroup;
  from?: string | null;
  to?: string | null;
  vanPlate?: string | null;
}): string {
  const prefix =
    input.kind === 'timeline'
      ? 'cash-ledger'
      : `cash-ledger-${input.kind === 'day' ? 'daily' : input.kind === 'week' ? 'weekly' : 'monthly'}`;
  const plate = sanitizeFilenamePart(input.vanPlate);
  return `${prefix}-${rangeDay(input.from)}_to_${rangeDay(input.to)}${plate ? `_van-${plate}` : ''}.csv`;
}

/**
 * Cash Ledger P5 — CSV export of the timeline and the daily / weekly / monthly
 * summary. Everything is composed from `VanCashLedgerService`'s PUBLIC reads
 * (`getTimeline`, `getDailySummary`), so an export can never disagree with what
 * the screen shows: same window, same filters, same running balance (filters
 * never change a balance — the service folds the unfiltered window first).
 */
@Injectable()
export class CashLedgerExportService {
  constructor(
    private readonly ledger: VanCashLedgerService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * ALL rows matching the timeline query (`page` / `limit` are ignored), oldest
   * first so the running balance reads top-down. Capped at {@link EXPORT_ROW_CAP};
   * when more rows match, the OLDEST are dropped and `truncated` is true.
   */
  async exportTimelineCsv(vendorId: string, query: VanCashLedgerTimelineQueryDto): Promise<CsvExportResult> {
    const collected: VanCashLedgerRow[] = [];
    let total = Number.POSITIVE_INFINITY;
    for (let page = 1; collected.length < total && collected.length < EXPORT_ROW_CAP; page += 1) {
      // getTimeline is newest-first and folds the balance over the WHOLE window before slicing.
      const result = await this.ledger.getTimeline(vendorId, { ...query, page, limit: EXPORT_PAGE_SIZE });
      total = result.meta.total;
      if (result.data.length === 0) break;
      collected.push(...result.data);
    }

    const truncated = total > EXPORT_ROW_CAP;
    const rows = collected.slice(0, EXPORT_ROW_CAP).reverse(); // newest-first -> chronological
    return {
      filename: buildExportFilename({
        kind: 'timeline',
        from: query.from,
        to: query.to,
        vanPlate: await this.vanPlate(vendorId, query.vanId),
      }),
      body: toCsv(TIMELINE_CSV_HEADERS, rows.map(timelineCsvRow)),
      truncated,
    };
  }

  /**
   * One row per day / week / month (oldest -> newest) + a final TOTAL row. The
   * statement columns are always the true full statement — entry filters never
   * apply, exactly like the table view.
   */
  async exportDailyCsv(vendorId: string, query: CashLedgerDailySummaryQueryDto): Promise<CsvExportResult> {
    const summary = await this.ledger.getDailySummary(vendorId, query);
    return {
      filename: buildExportFilename({
        kind: summary.group,
        from: summary.range.from ?? query.from,
        to: summary.range.to ?? query.to,
        vanPlate: await this.vanPlate(vendorId, query.vanId),
      }),
      body: toCsv(DAILY_CSV_HEADERS, dailyCsvRows(summary)),
      truncated: summary.truncated,
    };
  }

  /** The van's plate for the filename — vendor-scoped, so a foreign `vanId` simply yields no suffix. */
  private async vanPlate(vendorId: string, vanId: string | undefined): Promise<string | null> {
    if (!vanId) return null;
    const van = await this.prisma.van.findFirst({ where: { id: vanId, vendorId }, select: { plateNumber: true } });
    return van?.plateNumber ?? null;
  }
}

/** Summary rows (oldest first) + the TOTAL row. `summary.rows` arrives newest-first. */
export function dailyCsvRows(summary: CashLedgerDailySummary): CsvValue[][] {
  const chronological = [...summary.rows].reverse();
  const lines: CsvValue[][] = chronological.map((row) => [
    row.label,
    row.from,
    row.to,
    csvMoney(row.opening),
    csvMoney(row.sheetCashIn),
    csvMoney(row.officeCashIn),
    csvMoney(row.totalCashIn),
    csvMoney(round2(row.opening + row.totalCashIn)),
    csvMoney(row.officeExpenses),
    csvMoney(row.payrollCash),
    csvMoney(row.crewCash),
    csvMoney(row.totalExpenses),
    csvMoney(row.ownerTransfer),
    csvMoney(row.fuelCard),
    csvMoney(row.net),
    csvMoney(row.closing),
    csvInt(row.entryCount),
    csvInt(row.lateCount),
    csvInt(row.pendingCount),
  ]);

  const { totals, range } = summary;
  lines.push([
    'TOTAL',
    range.from ?? chronological[0]?.from ?? null,
    range.to ?? chronological[chronological.length - 1]?.to ?? null,
    csvMoney(totals.broughtForward),
    csvMoney(totals.sheetCashIn),
    csvMoney(totals.officeCashIn),
    csvMoney(totals.totalCashIn),
    csvMoney(round2(totals.broughtForward + totals.totalCashIn)),
    csvMoney(totals.officeExpenses),
    csvMoney(totals.payrollCash),
    csvMoney(totals.crewCash),
    csvMoney(totals.totalExpenses),
    csvMoney(totals.ownerTransfer),
    csvMoney(totals.fuelCard),
    csvMoney(totals.net),
    csvMoney(totals.expectedClosing),
    csvInt(totals.entryCount),
    csvInt(totals.lateCount),
    csvInt(totals.pendingCount),
  ]);
  return lines;
}

// Re-exported so the formatting helpers a spec needs live next to the composer.
export { formatPktDate };
