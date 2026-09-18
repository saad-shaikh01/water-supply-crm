#!/usr/bin/env node
// scripts/cash-ledger-restatement.ts
//
// Cash Ledger redesign, Phase P0 — RESTATEMENT REPORT (sign-off aid).
//
// Before the P0 migration (libs/shared/database/prisma/migrations/
// 20260918010000_cash_ledger_p0_foundations) is applied, the owner must approve
// how the Office Cash Ledger balance CHANGES. The ledger is only ~9 days old, so
// the restatement is applied in full (no cut-off date). For every vendor this
// script shows OLD vs NEW available cash and exactly WHY they differ:
//
//   A. approved-amount adjustments  — APPROVED handovers whose approvedAmount was
//                                     stored but never read by the old balance;
//   B. staff-ledger entries         — penalties / deductions / leave / bonuses /
//      no longer counted              PENDING advances ... the old balance deducted
//                                     every non-VOIDED entry; the new one deducts
//                                     only POSTED ADVANCE debits (they alone moved cash);
//   C. cash settlements             — payroll settlements paid in CASH, newly deducted.
//
// It also prints a per-PKT-day / per-month delta series (WHEN history shifts, and
// the first day each running balance would be negative) and a data-quality
// section (positive ADVANCE anomalies, PENDING ADVANCE entries, handover chains
// that do not reconcile).
//
// READ-ONLY BY CONSTRUCTION:
//   - The only database calls are findMany / $queryRaw SELECTs. There are NO
//     writes (no create/update/delete/upsert, no $executeRaw, no migrations).
//   - `--csv=<path>` writes a LOCAL FILE only; the database is never touched.
//   - It is meant to run against the PRE-MIGRATION database. The generated Prisma
//     client already knows VanCashHandover.expectedAmount but the DB column does
//     not exist yet, so EVERY query below uses an explicit `select` that omits it
//     (an unselected findMany would SELECT the missing column and fail).
//
// OLD vs NEW rules (old = git HEAD van-cash-ledger.service.ts, new = working copy):
//   OLD available = Σ opening + Σ handover.amount[APPROVED]
//                   − Σ direct cash expenses (paidFromCash, dailySheetId null)
//                   − Σ |staff-ledger amount| [category ≠ CREW_CASH, status ≠ VOIDED]
//                   − Σ remittance[APPROVED] − Σ fuel top-up[ACTIVE] − Σ standalone crew cash[ACTIVE]
//   NEW available = same opening / expense / remittance / fuel / crew terms
//                   + Σ handover FINAL amount (approvedAmount when set, else amount)
//                   − Σ |amount| of POSTED ADVANCE debits          (classifyStaffLedgerEntry)
//                   − Σ CASH settlements, dated by paidAt           (isCashSettlement)
//   Balances are reported as END-OF-DAY on the Asia/Karachi calendar day.
//
// Usage (run on the same host as the API, with DATABASE_URL present in the
// environment — e.g. on the VPS: `set -a; source .env.live; set +a`):
//   npm run report:cash-ledger-restatement
//   npm run report:cash-ledger-restatement -- --vendor=<vendorId>
//   npm run report:cash-ledger-restatement -- --csv=./cash-ledger-restatement.csv
//   (equivalent: node -r ./scripts/register-ts-paths.cjs scripts/cash-ledger-restatement.ts [--vendor=<id>] [--csv=<path>])

import {
  FuelCardTopUpStatus,
  LedgerEntryStatus,
  OfficeCashRemittanceStatus,
  PrismaClient,
  StaffLedgerCategory,
  StandaloneCrewCashStatus,
  SettlementMethod,
  VanCashHandoverStatus,
} from '@prisma/client';
import { writeFileSync } from 'fs';
import { vendorDateString } from '../apps/api-backend/src/app/common/helpers/date.util';
import {
  classifyStaffLedgerEntry,
  isCashSettlement,
} from '../apps/api-backend/src/app/modules/van-cash-ledger/cash-ledger-buckets';

// ─────────────────────────────────────────────────────────────────────────────
// Input row shapes (pre-fetched arrays — the pure core never touches the DB)
// ─────────────────────────────────────────────────────────────────────────────

export interface OpeningRow {
  id: string;
  openingBalance: number;
  openingDate: Date;
  note?: string | null;
}

export interface HandoverRow {
  id: string;
  vanId: string;
  vanLabel?: string | null;
  dailySheetId: string;
  /** OLD ledger figure — the claimed / sheet-derived amount (a DELTA for a corrections-chain row). */
  amount: number;
  approvedAmount: number | null;
  adjustmentReason: string | null;
  status: string;
  date: Date;
  correctsEntryId: string | null;
  createdAt: Date;
}

export interface ExpenseRow {
  id: string;
  amount: number;
  date: Date;
  paidFromCash: boolean;
  dailySheetId: string | null;
}

export interface StaffLedgerRow {
  id: string;
  employeeName?: string | null;
  category: string;
  status: string;
  /** Signed: negative = debit against the employee. */
  amount: number;
  effectiveDate: Date;
}

export interface MoneyMovementRow {
  id: string;
  amount: number;
  date: Date;
  status: string;
}

export interface SettlementRow {
  id: string;
  employeeName?: string | null;
  amount: number;
  method: string;
  paidAt: Date;
}

/** Everything the pure core needs for ONE vendor. */
export interface RestatementInput {
  vendorId: string;
  vendorName?: string;
  openings: OpeningRow[];
  handovers: HandoverRow[];
  expenses: ExpenseRow[];
  staffLedger: StaffLedgerRow[];
  remittances: MoneyMovementRow[];
  fuelTopUps: MoneyMovementRow[];
  crewCash: MoneyMovementRow[];
  settlements: SettlementRow[];
}

/** Pre-fetched data for possibly many vendors (each row carries its vendorId). */
export interface AllVendorsData {
  vendors: { id: string; name: string }[];
  openings: (OpeningRow & { vendorId: string })[];
  handovers: (HandoverRow & { vendorId: string })[];
  expenses: (ExpenseRow & { vendorId: string })[];
  staffLedger: (StaffLedgerRow & { vendorId: string })[];
  remittances: (MoneyMovementRow & { vendorId: string })[];
  fuelTopUps: (MoneyMovementRow & { vendorId: string })[];
  crewCash: (MoneyMovementRow & { vendorId: string })[];
  settlements: (SettlementRow & { vendorId: string })[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Output shapes
// ─────────────────────────────────────────────────────────────────────────────

/** Signed contributions to the balance, per term (credits +, debits −). */
export interface TermBreakdown {
  opening: number;
  handovers: number;
  expenses: number;
  staffLedger: number;
  cashSettlements: number;
  remittances: number;
  fuelTopUps: number;
  crewCash: number;
  available: number;
}

export interface AdjustmentItem {
  handoverId: string;
  dailySheetId: string;
  vanLabel: string;
  date: string; // PKT day
  oldAmount: number;
  approvedAmount: number;
  /** approved − old — the contribution to the delta. */
  effect: number;
  reason: string;
}

export interface StaffLedgerItem {
  id: string;
  employeeName: string;
  label: string; // category, or "ADVANCE(+ve anomaly)"
  category: string;
  status: string;
  amount: number;
  /** |amount| — the contribution to the delta (no longer deducted). */
  effect: number;
  date: string; // PKT day of effectiveDate
}

export interface StaffLedgerGroup {
  label: string;
  status: string;
  count: number;
  total: number;
}

export interface SettlementItem {
  id: string;
  employeeName: string;
  paidAt: string; // PKT day
  amount: number;
  /** −amount — the contribution to the delta (newly deducted). */
  effect: number;
}

export interface DaySeriesPoint {
  day: string; // PKT YYYY-MM-DD
  oldNet: number;
  newNet: number;
  /** newNet − oldNet for the day. */
  delta: number;
  oldRunning: number;
  newRunning: number;
  /** newRunning − oldRunning. */
  cumulativeDelta: number;
}

export interface MonthSeriesPoint {
  month: string; // YYYY-MM
  oldNet: number;
  newNet: number;
  delta: number;
  oldEnd: number;
  newEnd: number;
}

export interface NegativePoint {
  day: string;
  balance: number;
}

export interface ChainIssue {
  dailySheetId: string;
  issue: string;
  detail: string;
}

export interface Restatement {
  vendorId: string;
  vendorName: string;
  old: TermBreakdown;
  new: TermBreakdown;
  /** new.available − old.available. */
  delta: number;
  decomposition: {
    adjustments: { items: AdjustmentItem[]; total: number };
    staffLedger: { items: StaffLedgerItem[]; groups: StaffLedgerGroup[]; total: number };
    cashSettlements: { items: SettlementItem[]; total: number };
    /** A + B + C, summed from the itemised rows (independent of the term totals). */
    sum: number;
    /** True when sum == delta (2dp). */
    reconciles: boolean;
  };
  series: {
    days: DaySeriesPoint[];
    months: MonthSeriesPoint[];
    firstNegativeOld: NegativePoint | null;
    firstNegativeNew: NegativePoint | null;
    minOld: NegativePoint | null;
    minNew: NegativePoint | null;
    /** True when the day-series end balances equal the term-total balances. */
    endBalancesMatch: boolean;
  };
  quality: {
    positiveAdvances: StaffLedgerItem[];
    pendingAdvances: StaffLedgerItem[];
    pendingAdvancesTotal: number;
    chainIssues: ChainIssue[];
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure core
// ─────────────────────────────────────────────────────────────────────────────

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function sum(values: number[]): number {
  return round2(values.reduce((acc, v) => acc + v, 0));
}

function pkt(date: Date): string {
  return vendorDateString(date);
}

/** OLD rule — the old balance deducted every non-VOIDED, non-CREW_CASH staff-ledger entry by magnitude. */
function countedByOldRule(row: StaffLedgerRow): boolean {
  return row.category !== StaffLedgerCategory.CREW_CASH && row.status !== LedgerEntryStatus.VOIDED;
}

/** NEW rule — same classifier the service uses (only a POSTED ADVANCE debit is payroll cash). */
function countedByNewRule(row: StaffLedgerRow): boolean {
  return classifyStaffLedgerEntry(row) === 'PAYROLL_CASH';
}

function staffLabel(row: StaffLedgerRow): string {
  return row.category === StaffLedgerCategory.ADVANCE && row.amount > 0 ? 'ADVANCE(+ve anomaly)' : row.category;
}

function toStaffItem(row: StaffLedgerRow): StaffLedgerItem {
  return {
    id: row.id,
    employeeName: row.employeeName ?? '(unknown)',
    label: staffLabel(row),
    category: row.category,
    status: row.status,
    amount: row.amount,
    effect: Math.abs(row.amount),
    date: pkt(row.effectiveDate),
  };
}

/** NEW handover figure: the approver's final amount when set, else the claimed/sheet amount (what the migration backfill produces). */
function newHandoverAmount(row: HandoverRow): number {
  return row.approvedAmount !== null && row.approvedAmount !== undefined ? row.approvedAmount : row.amount;
}

/** A signed movement on a PKT day, under each rule. */
interface Movement {
  date: Date;
  oldAmount: number;
  newAmount: number;
}

function buildTerms(data: RestatementInput): { old: TermBreakdown; new: TermBreakdown; movements: Movement[] } {
  const movements: Movement[] = [];
  const oldT: TermBreakdown = zeroTerms();
  const newT: TermBreakdown = zeroTerms();

  for (const r of data.openings) {
    oldT.opening += r.openingBalance;
    newT.opening += r.openingBalance;
    movements.push({ date: r.openingDate, oldAmount: r.openingBalance, newAmount: r.openingBalance });
  }

  for (const r of data.handovers) {
    if (r.status !== VanCashHandoverStatus.APPROVED) continue;
    const o = r.amount;
    const n = newHandoverAmount(r);
    oldT.handovers += o;
    newT.handovers += n;
    movements.push({ date: r.date, oldAmount: o, newAmount: n });
  }

  for (const r of data.expenses) {
    if (!r.paidFromCash || r.dailySheetId !== null) continue;
    oldT.expenses -= r.amount;
    newT.expenses -= r.amount;
    movements.push({ date: r.date, oldAmount: -r.amount, newAmount: -r.amount });
  }

  for (const r of data.staffLedger) {
    const o = countedByOldRule(r) ? -Math.abs(r.amount) : 0;
    const n = countedByNewRule(r) ? -Math.abs(r.amount) : 0;
    if (o === 0 && n === 0) continue;
    oldT.staffLedger += o;
    newT.staffLedger += n;
    movements.push({ date: r.effectiveDate, oldAmount: o, newAmount: n });
  }

  for (const r of data.settlements) {
    if (!isCashSettlement(r.method)) continue;
    newT.cashSettlements -= r.amount;
    movements.push({ date: r.paidAt, oldAmount: 0, newAmount: -r.amount });
  }

  for (const r of data.remittances) {
    if (r.status !== OfficeCashRemittanceStatus.APPROVED) continue;
    oldT.remittances -= r.amount;
    newT.remittances -= r.amount;
    movements.push({ date: r.date, oldAmount: -r.amount, newAmount: -r.amount });
  }

  for (const r of data.fuelTopUps) {
    if (r.status !== FuelCardTopUpStatus.ACTIVE) continue;
    oldT.fuelTopUps -= r.amount;
    newT.fuelTopUps -= r.amount;
    movements.push({ date: r.date, oldAmount: -r.amount, newAmount: -r.amount });
  }

  for (const r of data.crewCash) {
    if (r.status !== StandaloneCrewCashStatus.ACTIVE) continue;
    oldT.crewCash -= r.amount;
    newT.crewCash -= r.amount;
    movements.push({ date: r.date, oldAmount: -r.amount, newAmount: -r.amount });
  }

  return { old: finishTerms(oldT), new: finishTerms(newT), movements };
}

function zeroTerms(): TermBreakdown {
  return {
    opening: 0,
    handovers: 0,
    expenses: 0,
    staffLedger: 0,
    cashSettlements: 0,
    remittances: 0,
    fuelTopUps: 0,
    crewCash: 0,
    available: 0,
  };
}

function finishTerms(t: TermBreakdown): TermBreakdown {
  const out = { ...t };
  for (const key of Object.keys(out) as (keyof TermBreakdown)[]) out[key] = round2(out[key]);
  out.available = round2(
    out.opening +
      out.handovers +
      out.expenses +
      out.staffLedger +
      out.cashSettlements +
      out.remittances +
      out.fuelTopUps +
      out.crewCash,
  );
  return out;
}

function buildSeries(movements: Movement[], oldAvailable: number, newAvailable: number) {
  const byDay = new Map<string, { oldNet: number; newNet: number }>();
  for (const m of movements) {
    const day = pkt(m.date);
    const cur = byDay.get(day) ?? { oldNet: 0, newNet: 0 };
    cur.oldNet += m.oldAmount;
    cur.newNet += m.newAmount;
    byDay.set(day, cur);
  }

  const days: DaySeriesPoint[] = [];
  let oldRunning = 0;
  let newRunning = 0;
  for (const day of [...byDay.keys()].sort()) {
    const cur = byDay.get(day)!;
    oldRunning = round2(oldRunning + cur.oldNet);
    newRunning = round2(newRunning + cur.newNet);
    days.push({
      day,
      oldNet: round2(cur.oldNet),
      newNet: round2(cur.newNet),
      delta: round2(cur.newNet - cur.oldNet),
      oldRunning,
      newRunning,
      cumulativeDelta: round2(newRunning - oldRunning),
    });
  }

  const monthMap = new Map<string, MonthSeriesPoint>();
  for (const d of days) {
    const month = d.day.slice(0, 7);
    const cur = monthMap.get(month) ?? { month, oldNet: 0, newNet: 0, delta: 0, oldEnd: 0, newEnd: 0 };
    cur.oldNet = round2(cur.oldNet + d.oldNet);
    cur.newNet = round2(cur.newNet + d.newNet);
    cur.delta = round2(cur.delta + d.delta);
    cur.oldEnd = d.oldRunning;
    cur.newEnd = d.newRunning;
    monthMap.set(month, cur);
  }

  const firstNegative = (pick: (d: DaySeriesPoint) => number): NegativePoint | null => {
    for (const d of days) if (pick(d) < 0) return { day: d.day, balance: pick(d) };
    return null;
  };
  const minimum = (pick: (d: DaySeriesPoint) => number): NegativePoint | null => {
    let best: NegativePoint | null = null;
    for (const d of days) if (best === null || pick(d) < best.balance) best = { day: d.day, balance: pick(d) };
    return best;
  };

  return {
    days,
    months: [...monthMap.values()],
    firstNegativeOld: firstNegative((d) => d.oldRunning),
    firstNegativeNew: firstNegative((d) => d.newRunning),
    minOld: minimum((d) => d.oldRunning),
    minNew: minimum((d) => d.newRunning),
    endBalancesMatch: round2(oldRunning) === round2(oldAvailable) && round2(newRunning) === round2(newAvailable),
  };
}

function buildChainIssues(handovers: HandoverRow[]): ChainIssue[] {
  const issues: ChainIssue[] = [];
  const bySheet = new Map<string, HandoverRow[]>();
  for (const h of handovers) {
    if (h.status === VanCashHandoverStatus.VOIDED) continue;
    const list = bySheet.get(h.dailySheetId) ?? [];
    list.push(h);
    bySheet.set(h.dailySheetId, list);
  }

  for (const [sheetId, rows] of bySheet) {
    const approved = rows.filter((r) => r.status === VanCashHandoverStatus.APPROVED);
    if (approved.length === 0) continue; // nothing counted in the ledger — not a reconciliation concern
    const ids = new Set(rows.map((r) => r.id));
    const originals = rows.filter((r) => r.correctsEntryId === null);
    const corrections = rows.filter((r) => r.correctsEntryId !== null);

    if (originals.length > 1) {
      issues.push({
        dailySheetId: sheetId,
        issue: 'DUPLICATE_ORIGINAL',
        detail: `${originals.length} non-correction handovers for one sheet (expected 1): ${originals
          .map((r) => `${r.id.slice(0, 8)}=${r.amount}`)
          .join(', ')}`,
      });
    }
    if (originals.length === 0) {
      issues.push({
        dailySheetId: sheetId,
        issue: 'NO_ORIGINAL',
        detail: `chain has ${corrections.length} correction row(s) but no original handover`,
      });
    }
    const dangling = corrections.filter((r) => !ids.has(r.correctsEntryId as string));
    if (dangling.length > 0) {
      issues.push({
        dailySheetId: sheetId,
        issue: 'DANGLING_CORRECTION',
        detail: `correction row(s) pointing outside the sheet's chain: ${dangling
          .map((r) => `${r.id.slice(0, 8)}->${(r.correctsEntryId as string).slice(0, 8)}`)
          .join(', ')}`,
      });
    }
    if (approved.length !== rows.length) {
      const chainTotal = sum(rows.map((r) => r.amount));
      const ledgerTotal = sum(approved.map((r) => r.amount));
      issues.push({
        dailySheetId: sheetId,
        issue: 'PARTIALLY_APPROVED_CHAIN',
        detail: `only ${approved.length}/${rows.length} rows are APPROVED — ledger counts ${ledgerTotal} of a chain total ${chainTotal}`,
      });
    }
    const approvedTotal = sum(approved.map((r) => r.amount));
    if (approvedTotal < 0) {
      issues.push({
        dailySheetId: sheetId,
        issue: 'NEGATIVE_CHAIN_TOTAL',
        detail: `Σ APPROVED amount = ${approvedTotal} (a sheet's cash can never net below zero)`,
      });
    }
  }
  return issues;
}

/**
 * The whole restatement for ONE vendor, as a PURE function over pre-fetched
 * arrays. Never reads the DB; safe to unit-test with hand-built fixtures.
 */
export function computeRestatement(data: RestatementInput): Restatement {
  const { old: oldT, new: newT, movements } = buildTerms(data);
  const delta = round2(newT.available - oldT.available);

  // A. approved-amount adjustments
  const adjItems: AdjustmentItem[] = data.handovers
    .filter(
      (h) =>
        h.status === VanCashHandoverStatus.APPROVED && h.approvedAmount !== null && h.approvedAmount !== h.amount,
    )
    .map((h) => ({
      handoverId: h.id,
      dailySheetId: h.dailySheetId,
      vanLabel: h.vanLabel ?? h.vanId,
      date: pkt(h.date),
      oldAmount: h.amount,
      approvedAmount: h.approvedAmount as number,
      effect: round2((h.approvedAmount as number) - h.amount),
      reason: h.adjustmentReason ?? '',
    }))
    .sort((a, b) => (a.date === b.date ? (a.handoverId < b.handoverId ? -1 : 1) : a.date < b.date ? -1 : 1));
  const adjTotal = sum(adjItems.map((i) => i.effect));

  // B. staff-ledger entries counted by the OLD rule but not by the NEW one
  const staffItems = data.staffLedger
    .filter((r) => countedByOldRule(r) && !countedByNewRule(r))
    .map(toStaffItem)
    .sort((a, b) => (a.date === b.date ? (a.id < b.id ? -1 : 1) : a.date < b.date ? -1 : 1));
  const groupMap = new Map<string, StaffLedgerGroup>();
  for (const it of staffItems) {
    const key = `${it.label}|${it.status}`;
    const g = groupMap.get(key) ?? { label: it.label, status: it.status, count: 0, total: 0 };
    g.count += 1;
    g.total = round2(g.total + it.effect);
    groupMap.set(key, g);
  }
  const staffGroups = [...groupMap.values()].sort((a, b) =>
    a.label === b.label ? (a.status < b.status ? -1 : 1) : a.label < b.label ? -1 : 1,
  );
  const staffTotal = sum(staffItems.map((i) => i.effect));

  // C. cash settlements newly counted
  const settlementItems: SettlementItem[] = data.settlements
    .filter((s) => isCashSettlement(s.method))
    .map((s) => ({
      id: s.id,
      employeeName: s.employeeName ?? '(unknown)',
      paidAt: pkt(s.paidAt),
      amount: s.amount,
      effect: -s.amount,
    }))
    .sort((a, b) => (a.paidAt === b.paidAt ? (a.id < b.id ? -1 : 1) : a.paidAt < b.paidAt ? -1 : 1));
  const settlementTotal = sum(settlementItems.map((i) => i.effect));

  const decompSum = round2(adjTotal + staffTotal + settlementTotal);

  // Data quality
  const advances = data.staffLedger.filter(
    (r) => r.category === StaffLedgerCategory.ADVANCE && r.status !== LedgerEntryStatus.VOIDED,
  );
  const positiveAdvances = advances.filter((r) => r.amount > 0).map(toStaffItem);
  const pendingAdvanceRows = advances.filter((r) => r.status === LedgerEntryStatus.PENDING && r.amount < 0);

  return {
    vendorId: data.vendorId,
    vendorName: data.vendorName ?? data.vendorId,
    old: oldT,
    new: newT,
    delta,
    decomposition: {
      adjustments: { items: adjItems, total: adjTotal },
      staffLedger: { items: staffItems, groups: staffGroups, total: staffTotal },
      cashSettlements: { items: settlementItems, total: settlementTotal },
      sum: decompSum,
      reconciles: decompSum === delta,
    },
    series: buildSeries(movements, oldT.available, newT.available),
    quality: {
      positiveAdvances,
      pendingAdvances: pendingAdvanceRows.map(toStaffItem),
      pendingAdvancesTotal: sum(pendingAdvanceRows.map((r) => Math.abs(r.amount))),
      chainIssues: buildChainIssues(data.handovers),
    },
  };
}

/** Splits multi-vendor data per vendor and restates each (vendors with no rows at all are skipped). */
export function computeAllRestatements(all: AllVendorsData): Restatement[] {
  const pick = <T extends { vendorId: string }>(rows: T[], vendorId: string): T[] =>
    rows.filter((r) => r.vendorId === vendorId);

  const out: Restatement[] = [];
  for (const v of all.vendors) {
    const input: RestatementInput = {
      vendorId: v.id,
      vendorName: v.name,
      openings: pick(all.openings, v.id),
      handovers: pick(all.handovers, v.id),
      expenses: pick(all.expenses, v.id),
      staffLedger: pick(all.staffLedger, v.id),
      remittances: pick(all.remittances, v.id),
      fuelTopUps: pick(all.fuelTopUps, v.id),
      crewCash: pick(all.crewCash, v.id),
      settlements: pick(all.settlements, v.id),
    };
    const rowCount =
      input.openings.length +
      input.handovers.length +
      input.expenses.length +
      input.staffLedger.length +
      input.remittances.length +
      input.fuelTopUps.length +
      input.crewCash.length +
      input.settlements.length;
    if (rowCount === 0) continue;
    out.push(computeRestatement(input));
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Formatting / rendering (pure — returns strings)
// ─────────────────────────────────────────────────────────────────────────────

/** 1234567.5 -> "1,234,567.5"; whole rupees show no decimals. */
export function fmtNum(n: number, withSign = false): string {
  const abs = Math.abs(round2(n));
  const body = abs.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  if (round2(n) < 0) return `-${body}`;
  return withSign && round2(n) > 0 ? `+${body}` : body;
}

export function fmtRs(n: number, withSign = false): string {
  return `Rs ${fmtNum(n, withSign)}`;
}

function pad(text: string, width: number, align: 'l' | 'r'): string {
  return align === 'r' ? text.padStart(width) : text.padEnd(width);
}

export function renderTable(headers: string[], rows: string[][], align: ('l' | 'r')[], indent = '  '): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const line = (cells: string[]) =>
    (indent + cells.map((c, i) => pad(c ?? '', widths[i], align[i])).join('  ')).trimEnd();
  const sep = indent + widths.map((w) => '-'.repeat(w)).join('  ');
  return [line(headers), sep, ...rows.map(line)].join('\n');
}

const RULE = '='.repeat(96);
const THIN = '-'.repeat(96);

export function renderRestatement(r: Restatement): string {
  const out: string[] = [];
  const push = (s = '') => out.push(s);

  push(RULE);
  push(`VENDOR  ${r.vendorName}   (${r.vendorId})`);
  push(RULE);

  // 1. headline
  push();
  push('1. AVAILABLE OFFICE CASH');
  push(`   OLD (current rules) : ${fmtRs(r.old.available)}`);
  push(`   NEW (P0 rules)      : ${fmtRs(r.new.available)}`);
  const pct = r.old.available !== 0 ? ` (${fmtNum(round2((r.delta / Math.abs(r.old.available)) * 100), true)}%)` : '';
  push(`   DELTA               : ${fmtRs(r.delta, true)}${pct}`);
  push();
  const term = (label: string, o: number, n: number) => [label, fmtNum(o), fmtNum(n), fmtNum(n - o, true)];
  push(
    renderTable(
      ['Term (signed contribution, Rs)', 'OLD', 'NEW', 'Diff'],
      [
        term('Opening / manual cash-in', r.old.opening, r.new.opening),
        term('Handovers (APPROVED)', r.old.handovers, r.new.handovers),
        term('Direct office cash expenses', r.old.expenses, r.new.expenses),
        term('Staff ledger / payroll advances', r.old.staffLedger, r.new.staffLedger),
        term('Payroll CASH settlements', r.old.cashSettlements, r.new.cashSettlements),
        term('Owner remittances (APPROVED)', r.old.remittances, r.new.remittances),
        term('Fuel-card top-ups (ACTIVE)', r.old.fuelTopUps, r.new.fuelTopUps),
        term('Standalone crew cash (ACTIVE)', r.old.crewCash, r.new.crewCash),
        term('AVAILABLE', r.old.available, r.new.available),
      ],
      ['l', 'r', 'r', 'r'],
    ),
  );

  // 2. decomposition
  const d = r.decomposition;
  push();
  push('2. WHY IT CHANGES (delta decomposition)');
  push();
  push(`   A. Approved-amount adjustments   ${fmtRs(d.adjustments.total, true)}   (${d.adjustments.items.length} handover row(s))`);
  push('      APPROVED handovers whose approvedAmount differs from the claimed amount. The old balance ignored');
  push('      approvedAmount; the new one uses it. Effect = approved - old.');
  if (d.adjustments.items.length > 0) {
    push(
      renderTable(
        ['Sheet', 'Van', 'Date', 'Old amount', 'Approved', 'Effect', 'Reason'],
        d.adjustments.items.map((i) => [
          i.dailySheetId.slice(0, 8),
          i.vanLabel,
          i.date,
          fmtNum(i.oldAmount),
          fmtNum(i.approvedAmount),
          fmtNum(i.effect, true),
          i.reason || '(none recorded)',
        ]),
        ['l', 'l', 'l', 'r', 'r', 'r', 'l'],
        '      ',
      ),
    );
  }

  push();
  push(`   B. Staff-ledger entries no longer counted   ${fmtRs(d.staffLedger.total, true)}   (${d.staffLedger.items.length} entr${d.staffLedger.items.length === 1 ? 'y' : 'ies'})`);
  push('      The old balance deducted every non-VOIDED, non-CREW_CASH entry by magnitude; the new one deducts only');
  push('      POSTED ADVANCE debits. Effect = +|amount| (the deduction is removed). Grouped by category x status.');
  if (d.staffLedger.groups.length > 0) {
    push(
      renderTable(
        ['Category', 'Status', 'Count', 'Effect (Rs)'],
        [
          ...d.staffLedger.groups.map((g) => [g.label, g.status, String(g.count), fmtNum(g.total, true)]),
          ['TOTAL', '', String(d.staffLedger.items.length), fmtNum(d.staffLedger.total, true)],
        ],
        ['l', 'l', 'r', 'r'],
        '      ',
      ),
    );
  }

  push();
  push(`   C. Cash settlements newly counted   ${fmtRs(d.cashSettlements.total, true)}   (${d.cashSettlements.items.length} settlement(s))`);
  push('      Payroll settlements paid in CASH now leave office cash (dated by paidAt). Effect = -amount.');
  if (d.cashSettlements.items.length > 0) {
    push(
      renderTable(
        ['Employee', 'Paid at', 'Amount', 'Effect'],
        d.cashSettlements.items.map((i) => [i.employeeName, i.paidAt, fmtNum(i.amount), fmtNum(i.effect, true)]),
        ['l', 'l', 'r', 'r'],
        '      ',
      ),
    );
  }

  push();
  push(
    `   CHECK  A + B + C = ${fmtRs(d.sum, true)}   vs   NEW - OLD = ${fmtRs(r.delta, true)}   ->   ${
      d.reconciles ? 'OK (reconciles exactly)' : 'MISMATCH'
    }`,
  );
  if (!d.reconciles) {
    push(`   !!! WARNING: the decomposition does NOT sum to the delta (off by ${fmtRs(round2(r.delta - d.sum), true)}).`);
    push('   !!! Do not sign off on this vendor until the difference is explained.');
  }

  // 3. series
  const s = r.series;
  push();
  push('3. WHEN HISTORY SHIFTS (Asia/Karachi calendar days, END-OF-DAY balances)');
  const shiftDays = s.days.filter((x) => x.delta !== 0);
  if (shiftDays.length === 0) {
    push('   No day changes (OLD and NEW movements are identical every day).');
  } else {
    push(`   Days whose movement changes (${shiftDays.length} of ${s.days.length} active day(s)):`);
    push(
      renderTable(
        ['Day', 'OLD net', 'NEW net', 'Day delta', 'OLD balance', 'NEW balance', 'Cumul. delta'],
        shiftDays.map((x) => [
          x.day,
          fmtNum(x.oldNet, true),
          fmtNum(x.newNet, true),
          fmtNum(x.delta, true),
          fmtNum(x.oldRunning),
          fmtNum(x.newRunning),
          fmtNum(x.cumulativeDelta, true),
        ]),
        ['l', 'r', 'r', 'r', 'r', 'r', 'r'],
        '   ',
      ),
    );
  }
  push();
  push('   Per month:');
  push(
    renderTable(
      ['Month', 'OLD net', 'NEW net', 'Month delta', 'OLD end bal.', 'NEW end bal.'],
      s.months.map((m) => [
        m.month,
        fmtNum(m.oldNet, true),
        fmtNum(m.newNet, true),
        fmtNum(m.delta, true),
        fmtNum(m.oldEnd),
        fmtNum(m.newEnd),
      ]),
      ['l', 'r', 'r', 'r', 'r', 'r'],
      '   ',
    ),
  );
  push();
  const neg = (label: string, p: NegativePoint | null, min: NegativePoint | null) =>
    p
      ? `   ${label} running balance first goes NEGATIVE on ${p.day} (${fmtRs(p.balance)}); lowest ${min ? `${fmtRs(min.balance)} on ${min.day}` : '-'}.`
      : `   ${label} running balance never goes negative${min ? ` (lowest ${fmtRs(min.balance)} on ${min.day})` : ''}.`;
  push(neg('OLD', s.firstNegativeOld, s.minOld));
  push(neg('NEW', s.firstNegativeNew, s.minNew));
  if (!s.endBalancesMatch) {
    push('   !!! WARNING: the day series does not end at the term-total balances (internal inconsistency).');
  }

  // 4. data quality
  const q = r.quality;
  push();
  push('4. DATA QUALITY');
  push(`   Positive ADVANCE entries (anomaly - an advance is always a debit): ${q.positiveAdvances.length}`);
  if (q.positiveAdvances.length > 0) {
    push(
      renderTable(
        ['Entry', 'Employee', 'Day', 'Status', 'Amount'],
        q.positiveAdvances.map((i) => [i.id.slice(0, 8), i.employeeName, i.date, i.status, fmtNum(i.amount, true)]),
        ['l', 'l', 'l', 'l', 'r'],
        '      ',
      ),
    );
  }
  push(
    `   ADVANCE entries still PENDING (cash may already be out; NEW ignores them until POSTED): ${q.pendingAdvances.length}` +
      (q.pendingAdvances.length > 0 ? `  totalling ${fmtRs(q.pendingAdvancesTotal)}` : ''),
  );
  if (q.pendingAdvances.length > 0) {
    push(
      renderTable(
        ['Entry', 'Employee', 'Day', 'Amount'],
        q.pendingAdvances.map((i) => [i.id.slice(0, 8), i.employeeName, i.date, fmtNum(i.amount, true)]),
        ['l', 'l', 'l', 'r'],
        '      ',
      ),
    );
  }
  push(`   Handover chains that do not reconcile with their own rows (none expected): ${q.chainIssues.length}`);
  if (q.chainIssues.length > 0) {
    push(
      renderTable(
        ['Sheet', 'Issue', 'Detail'],
        q.chainIssues.map((c) => [c.dailySheetId.slice(0, 8), c.issue, c.detail]),
        ['l', 'l', 'l'],
        '      ',
      ),
    );
  }
  push();
  return out.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV (pure — returns a string)
// ─────────────────────────────────────────────────────────────────────────────

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value);
  // Neutralise spreadsheet formula injection in free-text cells.
  const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const CSV_HEADER = [
  'vendorId',
  'section',
  'date',
  'ref',
  'label',
  'category',
  'status',
  'oldAmount',
  'newAmount',
  'delta',
  'detail',
];

/** Long-format CSV: one file, a `section` column (DAY, MONTH, ADJUSTMENT, STAFF_ENTRY, SETTLEMENT, ADVANCE_ANOMALY, CHAIN_ISSUE, SUMMARY). */
export function buildCsv(restatements: Restatement[]): string {
  const lines: string[] = [CSV_HEADER.join(',')];
  const add = (cells: (string | number | null | undefined)[]) => lines.push(cells.map(csvCell).join(','));

  for (const r of restatements) {
    const v = r.vendorId;
    add([v, 'SUMMARY', '', '', r.vendorName, '', '', r.old.available, r.new.available, r.delta, r.decomposition.reconciles ? 'reconciles' : 'MISMATCH']);
    for (const d of r.series.days) {
      add([v, 'DAY', d.day, '', '', '', '', d.oldRunning, d.newRunning, d.delta, `oldNet=${d.oldNet}; newNet=${d.newNet}; cumulativeDelta=${d.cumulativeDelta}`]);
    }
    for (const m of r.series.months) {
      add([v, 'MONTH', m.month, '', '', '', '', m.oldEnd, m.newEnd, m.delta, `oldNet=${m.oldNet}; newNet=${m.newNet}`]);
    }
    for (const a of r.decomposition.adjustments.items) {
      add([v, 'ADJUSTMENT', a.date, a.handoverId, `sheet ${a.dailySheetId} / ${a.vanLabel}`, 'HANDOVER', 'APPROVED', a.oldAmount, a.approvedAmount, a.effect, a.reason]);
    }
    for (const e of r.decomposition.staffLedger.items) {
      add([v, 'STAFF_ENTRY', e.date, e.id, e.employeeName, e.label, e.status, e.amount, 0, e.effect, 'no longer deducted']);
    }
    for (const s of r.decomposition.cashSettlements.items) {
      add([v, 'SETTLEMENT', s.paidAt, s.id, s.employeeName, 'CASH_SETTLEMENT', '', 0, -s.amount, s.effect, 'newly deducted']);
    }
    for (const e of r.quality.positiveAdvances) {
      add([v, 'ADVANCE_ANOMALY', e.date, e.id, e.employeeName, e.category, e.status, e.amount, '', '', 'positive ADVANCE']);
    }
    for (const e of r.quality.pendingAdvances) {
      add([v, 'ADVANCE_PENDING', e.date, e.id, e.employeeName, e.category, e.status, e.amount, '', '', 'PENDING advance']);
    }
    for (const c of r.quality.chainIssues) {
      add([v, 'CHAIN_ISSUE', '', c.dailySheetId, c.issue, '', '', '', '', '', c.detail]);
    }
  }
  return lines.join('\n') + '\n';
}

// ─────────────────────────────────────────────────────────────────────────────
// DB fetch — READ-ONLY. Explicit `select` everywhere; VanCashHandover NEVER
// selects `expectedAmount` (the column does not exist pre-migration).
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchAllVendorsData(prisma: PrismaClient, vendorId?: string): Promise<AllVendorsData> {
  const vendorWhere = vendorId ? { vendorId } : {};

  const [
    vendors,
    openings,
    handovers,
    expenses,
    staffLedger,
    remittances,
    fuelTopUps,
    crewCash,
    settlements,
  ] = await Promise.all([
    prisma.vendor.findMany({
      where: vendorId ? { id: vendorId } : {},
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.vanCashOpeningBalance.findMany({
      where: vendorWhere,
      select: { id: true, vendorId: true, openingBalance: true, openingDate: true, note: true },
    }),
    // All statuses (chain-reconciliation checks need PENDING/VOIDED rows too).
    // NO `expectedAmount` — the column does not exist before the migration.
    prisma.vanCashHandover.findMany({
      where: vendorWhere,
      select: {
        id: true,
        vendorId: true,
        vanId: true,
        dailySheetId: true,
        amount: true,
        approvedAmount: true,
        adjustmentReason: true,
        status: true,
        date: true,
        correctsEntryId: true,
        createdAt: true,
        van: { select: { plateNumber: true } },
      },
      orderBy: { date: 'asc' },
    }),
    prisma.expense.findMany({
      where: { ...vendorWhere, paidFromCash: true, dailySheetId: null },
      select: { id: true, vendorId: true, amount: true, date: true, paidFromCash: true, dailySheetId: true },
    }),
    // Superset of what either rule counts (OLD: every non-VOIDED, non-CREW_CASH entry).
    prisma.staffLedgerEntry.findMany({
      where: {
        ...vendorWhere,
        category: { not: StaffLedgerCategory.CREW_CASH },
        status: { not: LedgerEntryStatus.VOIDED },
      },
      select: {
        id: true,
        vendorId: true,
        category: true,
        status: true,
        amount: true,
        effectiveDate: true,
        user: { select: { name: true } },
      },
    }),
    prisma.officeCashRemittance.findMany({
      where: { ...vendorWhere, status: OfficeCashRemittanceStatus.APPROVED },
      select: { id: true, vendorId: true, amount: true, date: true, status: true },
    }),
    prisma.fuelCardTopUp.findMany({
      where: { ...vendorWhere, status: FuelCardTopUpStatus.ACTIVE },
      select: { id: true, vendorId: true, amount: true, date: true, status: true },
    }),
    prisma.standaloneCrewCashExpense.findMany({
      where: { ...vendorWhere, status: StandaloneCrewCashStatus.ACTIVE },
      select: { id: true, vendorId: true, amount: true, date: true, status: true },
    }),
    prisma.settlement.findMany({
      where: { ...vendorWhere, method: SettlementMethod.CASH },
      select: {
        id: true,
        vendorId: true,
        amount: true,
        method: true,
        paidAt: true,
        payrollEntry: { select: { user: { select: { name: true } } } },
      },
    }),
  ]);

  return {
    vendors,
    openings,
    handovers: handovers.map((h) => ({
      id: h.id,
      vendorId: h.vendorId,
      vanId: h.vanId,
      vanLabel: h.van?.plateNumber ?? null,
      dailySheetId: h.dailySheetId,
      amount: h.amount,
      approvedAmount: h.approvedAmount,
      adjustmentReason: h.adjustmentReason,
      status: h.status,
      date: h.date,
      correctsEntryId: h.correctsEntryId,
      createdAt: h.createdAt,
    })),
    expenses,
    staffLedger: staffLedger.map((e) => ({
      id: e.id,
      vendorId: e.vendorId,
      employeeName: e.user?.name ?? null,
      category: e.category,
      status: e.status,
      amount: e.amount,
      effectiveDate: e.effectiveDate,
    })),
    remittances,
    fuelTopUps,
    crewCash,
    settlements: settlements.map((s) => ({
      id: s.id,
      vendorId: s.vendorId,
      employeeName: s.payrollEntry?.user?.name ?? null,
      amount: s.amount,
      method: s.method,
      paidAt: s.paidAt,
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

interface CliArgs {
  vendor?: string;
  csv?: string;
  help: boolean;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { help: false };
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg.startsWith('--vendor=')) args.vendor = arg.slice('--vendor='.length).trim() || undefined;
    else if (arg.startsWith('--csv=')) args.csv = arg.slice('--csv='.length).trim() || undefined;
    else throw new Error(`Unknown argument: ${arg}  (supported: --vendor=<vendorId> --csv=<path> --help)`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: npm run report:cash-ledger-restatement [-- --vendor=<vendorId>] [-- --csv=<path>]');
    console.log('READ-ONLY restatement report for the Cash Ledger P0 migration. Run BEFORE applying the migration.');
    return;
  }

  const prisma = new PrismaClient();
  try {
    // Guard: if the migration is already applied, `amount` has already been
    // overwritten with approvedAmount and the OLD figures are no longer recoverable.
    const applied = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'VanCashHandover' AND column_name = 'expectedAmount'`;
    if (applied.length > 0) {
      console.warn(
        '\n!!! WARNING: VanCashHandover.expectedAmount already exists - the P0 migration appears to be APPLIED.\n' +
          '!!! VanCashHandover.amount has already been restated, so OLD figures below are NOT the pre-migration balances.\n',
      );
    }

    const data = await fetchAllVendorsData(prisma, args.vendor);
    if (args.vendor && data.vendors.length === 0) {
      console.error(`No vendor found with id ${args.vendor}.`);
      process.exitCode = 1;
      return;
    }

    const restatements = computeAllRestatements(data);
    console.log('CASH LEDGER P0 RESTATEMENT REPORT  (read-only; OLD = current rules, NEW = P0 rules)');
    console.log(`Generated ${new Date().toISOString()}  -  ${restatements.length} vendor(s) with cash-ledger activity`);
    console.log();

    for (const r of restatements) console.log(renderRestatement(r));

    if (restatements.length > 1) {
      console.log(THIN);
      console.log('ALL VENDORS');
      console.log(
        renderTable(
          ['Vendor', 'OLD available', 'NEW available', 'Delta', 'Reconciles'],
          restatements.map((r) => [
            r.vendorName,
            fmtNum(r.old.available),
            fmtNum(r.new.available),
            fmtNum(r.delta, true),
            r.decomposition.reconciles ? 'yes' : 'NO',
          ]),
          ['l', 'r', 'r', 'r', 'l'],
        ),
      );
    }

    if (args.csv) {
      writeFileSync(args.csv, buildCsv(restatements), 'utf8');
      console.log(`\nCSV detail written to ${args.csv}`);
    }

    if (restatements.some((r) => !r.decomposition.reconciles || !r.series.endBalancesMatch)) {
      console.error('\n!!! One or more vendors failed the reconciliation check - see warnings above.');
      process.exitCode = 2;
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
