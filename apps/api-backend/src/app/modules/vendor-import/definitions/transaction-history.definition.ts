import { createHash, randomUUID } from 'crypto';
import { ImportEntity, Prisma, TransactionType } from '@prisma/client';
import type { PrismaService } from '@water-supply-crm/database';
import { HISTORY_IMPORT_LIMITS } from '../import.constants';
import { ImportError } from '../import.types';
import type {
  HistoryPlanSummary,
  ImportFieldDef,
  ImportMapping,
  NormalizedRowResult,
  PlanSummary,
  PlannedRow,
  RawCell,
  RawRow,
  RowIssue,
} from '../import.types';
import { parseMoney, parseText, parseWholeNumber, toPaise } from '../pipeline/value-parsers';
import type { ExecOutcome, GroupRow, GroupRowOutcome, ImportDefinition, OptionsInfo } from './import-definition';
import { revertHistoryRows } from './transaction-history.revert';

/**
 * TRANSACTION_HISTORY - import past vouchers (charges, payments, bottle movement) for customers
 * that already exist. Design: docs/features/vendor-history-import-design.md.
 *
 *  - Ledger-only: Transaction rows, no DailySheet/DailySheetItem, so the Cash Ledger is untouched.
 *  - EXPLAIN mode: the customer's current financialBalance / wallet are NEVER changed. The file's
 *    last running balance must equal the balance the customer already has (reconciliation).
 *  - One customer = one chain: all of a customer's rows are imported together or not at all.
 *  - New posting path (LedgerService is not used and not modified).
 */

export const HISTORY_HTML_HEADERS = [
  'Customer Code',
  'Voucher',
  'Date',
  'Filled',
  'Empty',
  'Bottle Balance After',
  'Charge',
  'Paid',
  'Outstanding After',
];

export type ReportingMode = 'STATEMENT_ONLY' | 'COUNT_IN_REPORTS';

export interface HistoryOptions {
  /** YYYY-MM-DD - last day the file covers; later rows are errors (live data owns them). */
  cutoverDate: string;
  reportingMode: ReportingMode;
  productId: string | null;
  dateOrder: 'MDY' | 'DMY';
  reportsAcknowledged: boolean;
}

export interface NormalizedVoucher {
  /** false when a field of this row could not be read (the row is an ERROR). */
  valid: boolean;
  customerCode: string;
  voucher: string | null;
  /** YYYY-MM-DD */
  date: string | null;
  filled: number;
  empty: number;
  charge: number;
  paid: number;
  outstandingAfter: number | null;
  bottleBalanceAfter: number | null;
  /** Stamped on postable rows by the planner: the customer chain's final file balances. */
  reconcile?: { finalOutstanding: number | null; finalBottles: number | null };
}

interface CustomerFacts {
  id: string;
  isActive: boolean;
  financialBalance: number;
  walletBalance: number | null;
}

interface HistoryContext {
  customers: Map<string, CustomerFacts>;
  postMoney: Map<string, number>;
  postBottles: Map<string, number>;
  existingKeys: Set<string>;
  keys: Map<number, string>;
}

interface HistoryExec {
  batchId: string | null;
}

const FIELDS: ImportFieldDef[] = [
  {
    key: 'customerCode',
    label: 'Customer code',
    type: 'text',
    required: true,
    help: 'Must match a customer that already exists. Unknown codes are skipped and listed.',
    aliases: ['code', 'cust code', 'customer id', 'cust id', 'id', 'account no', 'account number', 'customer no', 'ref', 'reference'],
  },
  {
    key: 'voucher',
    label: 'Voucher / invoice no.',
    type: 'text',
    required: false,
    help: 'Used to recognise a row that was already imported.',
    aliases: ['voucher', 'voucher no', 'vch', 'vch no', 'invoice', 'invoice no', 'bill no', 'receipt no', 'trans no', 'transaction no'],
  },
  {
    key: 'date',
    label: 'Date',
    type: 'text',
    required: true,
    aliases: ['date', 'voucher date', 'txn date', 'transaction date', 'trans date', 'delivery date', 'entry date'],
  },
  {
    key: 'filled',
    label: 'Filled bottles delivered',
    type: 'int',
    required: false,
    aliases: ['filled', 'filled bottles', 'delivered', 'bottles delivered', 'qty', 'quantity', 'bottles out', 'issue'],
  },
  {
    key: 'empty',
    label: 'Empty bottles received',
    type: 'int',
    required: false,
    aliases: ['empty', 'empty bottles', 'received', 'bottles received', 'returned', 'bottles in', 'empties', 'return'],
  },
  {
    key: 'bottleBalanceAfter',
    label: 'Bottle balance after this voucher',
    type: 'int',
    required: false,
    help: 'Used to check the customer’s bottle balance at the end of the file.',
    aliases: ['bottle balance after', 'bottle balance', 'bottle bal', 'bottle bal after', 'bottles balance', 'running bottles'],
  },
  {
    key: 'charge',
    label: 'Charge (amount billed)',
    type: 'money',
    required: false,
    aliases: ['charge', 'charges', 'amount', 'sale', 'bill amount', 'invoice amount', 'debit', 'billed'],
  },
  {
    key: 'paid',
    label: 'Paid (amount received)',
    type: 'money',
    required: false,
    aliases: ['paid', 'payment', 'received amount', 'cash received', 'credit', 'collection', 'amount paid', 'receipt'],
  },
  {
    key: 'outstandingAfter',
    label: 'Outstanding after this voucher',
    type: 'money',
    required: false,
    help: 'Used to check the customer’s balance at the end of the file. Without it the check is skipped (warning).',
    aliases: ['outstanding after', 'outstanding', 'balance after', 'balance', 'closing balance', 'running balance', 'outstanding bal'],
  },
];

const err = (code: string, message: string, field?: string, data?: RowIssue['data']): RowIssue => ({ severity: 'ERROR', code, message, field, data });
const warn = (code: string, message: string, field?: string, data?: RowIssue['data']): RowIssue => ({ severity: 'WARNING', code, message, field, data });

// ── dates (vendor timezone is Asia/Karachi, UTC+5, no DST) ───────────────────

const PKT_OFFSET_MS = 5 * 3600 * 1000;
const DAY_MS = 86_400_000;

export function todayPkt(now = Date.now()): string {
  return new Date(now + PKT_OFFSET_MS).toISOString().slice(0, 10);
}

/** First instant AFTER the cutover day, in PKT: rows from here on belong to live data. */
export function cutoverEndUtc(cutoverDate: string): Date {
  return new Date(Date.parse(`${cutoverDate}T00:00:00.000Z`) + DAY_MS - PKT_OFFSET_MS);
}

/** A voucher dated D is stored at 12:00 PKT, so it can never slip across a month boundary. */
export function voucherInstant(date: string, offsetSeconds: number): Date {
  return new Date(Date.parse(`${date}T12:00:00.000Z`) - PKT_OFFSET_MS + offsetSeconds * 1000);
}

function isRealDate(y: number, m: number, d: number): boolean {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

export function parseVoucherDate(c: RawCell | undefined, order: 'MDY' | 'DMY'): string | null {
  if (c === null || c === undefined || c === '') return null;
  if (typeof c === 'number') {
    if (c < 20000 || c > 80000) return null; // Excel serial date window (1954-2119)
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(c) * DAY_MS).toISOString().slice(0, 10);
  }
  if (typeof c !== 'string') return null;
  const t = c.trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/.exec(t);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return isRealDate(y, mo, d) ? `${y}-${pad2(mo)}-${pad2(d)}` : null;
  }
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(t);
  if (m) {
    let y = Number(m[3]);
    if (m[3].length === 2) y += 2000;
    const a = Number(m[1]);
    const b = Number(m[2]);
    const [mo, d] = order === 'MDY' ? [a, b] : [b, a];
    return isRealDate(y, mo, d) ? `${y}-${pad2(mo)}-${pad2(d)}` : null;
  }
  return null;
}

// ── idempotency ──────────────────────────────────────────────────────────────

/**
 * dedupeKey = sha256(vendor|code|voucher|date|filled|empty|charge|paid). A blank voucher gets an
 * ordinal (`#n`) so two genuinely identical same-day vouchers both import, in file order. A
 * repeated key WITH a voucher number is a duplicate row and is skipped by the planner.
 */
export function computeDedupeKeys(vendorId: string, rows: { rowNumber: number; normalized: NormalizedVoucher | null }[]): Map<number, string> {
  const keys = new Map<number, string>();
  const ordinal = new Map<string, number>();
  for (const r of [...rows].sort((a, b) => a.rowNumber - b.rowNumber)) {
    const n = r.normalized;
    if (!n || !n.date) continue;
    const base = createHash('sha256')
      .update([vendorId, n.customerCode, n.voucher ?? '', n.date, n.filled, n.empty, n.charge.toFixed(2), n.paid.toFixed(2)].join('|'))
      .digest('hex');
    if (n.voucher) {
      keys.set(r.rowNumber, base);
    } else {
      const k = (ordinal.get(base) ?? 0) + 1;
      ordinal.set(base, k);
      keys.set(r.rowNumber, `${base}#${k}`);
    }
  }
  return keys;
}

function chunk<T>(a: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += size) out.push(a.slice(i, i + size));
  return out;
}

const hasMovement = (n: NormalizedVoucher) => n.charge !== 0 || n.filled !== 0 || n.empty !== 0 || n.paid !== 0;

function fieldHeaders(mapping: ImportMapping): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [header, key] of Object.entries(mapping.columns)) if (key) out[key] = header;
  return out;
}

interface PlanEntry {
  row: { rowNumber: number; normalized: NormalizedVoucher | null; issues: RowIssue[] };
  issues: RowIssue[];
  n: NormalizedVoucher | null;
  key: string | null;
  skip: null | 'DUP' | 'EXISTING' | 'NOOP';
  action: PlannedRow<NormalizedVoucher>['action'];
}

export const transactionHistoryDefinition: ImportDefinition<NormalizedVoucher, HistoryOptions, HistoryContext, HistoryExec> = {
  entity: ImportEntity.TRANSACTION_HISTORY,
  label: 'Transaction history',
  fields: FIELDS,
  asyncPlan: true,
  htmlFormat: { headers: HISTORY_HTML_HEADERS },
  limits: HISTORY_IMPORT_LIMITS,
  nothingToImportMessage: 'There is nothing to import - no new vouchers for matched customers in this file.',
  cacheScope: 'reports',

  requiredMappings() {
    return [
      { anyOf: ['customerCode'], message: 'Map the column that holds the customer code.' },
      { anyOf: ['date'], message: 'Map the column that holds the voucher date.' },
      { anyOf: ['charge', 'paid', 'filled', 'empty'], message: 'Map at least one of: charge, paid, filled bottles, empty bottles.' },
    ];
  },

  parseOptions(raw, info: OptionsInfo): HistoryOptions {
    const o = (raw ?? {}) as Record<string, unknown>;
    const mapped = info.mappedFieldKeys;
    const today = todayPkt();

    const cutoverDate = typeof o['cutoverDate'] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o['cutoverDate']) ? (o['cutoverDate'] as string) : null;
    if (!cutoverDate || !isRealDate(Number(cutoverDate.slice(0, 4)), Number(cutoverDate.slice(5, 7)), Number(cutoverDate.slice(8, 10)))) {
      throw new ImportError('CUTOVER_REQUIRED', 'Enter the cutover date: the last day this file covers (YYYY-MM-DD). Rows after it are not imported.');
    }
    if (cutoverDate > today) throw new ImportError('CUTOVER_REQUIRED', 'The cutover date cannot be in the future.');

    const reportingMode: ReportingMode = o['reportingMode'] === 'COUNT_IN_REPORTS' ? 'COUNT_IN_REPORTS' : 'STATEMENT_ONLY';
    const reportsAcknowledged = o['reportsAcknowledged'] === true;
    if (reportingMode === 'COUNT_IN_REPORTS') {
      if (!reportsAcknowledged) {
        throw new ImportError(
          'REPORTS_ACK_REQUIRED',
          'Tick the confirmation: old months’ sales and received amounts will appear in reports, but those months have no expenses or cost of goods.',
        );
      }
      const monthStart = `${today.slice(0, 7)}-01`;
      if (cutoverDate >= monthStart) {
        throw new ImportError('CUTOVER_TOO_RECENT', 'To count history in reports, the cutover date must be before the first day of the current month, so this month’s numbers are not changed.');
      }
    }

    const bottles = mapped.has('filled') || mapped.has('empty') || mapped.has('bottleBalanceAfter');
    let productId: string | null = typeof o['productId'] === 'string' && o['productId'] ? (o['productId'] as string) : null;
    if (bottles) {
      if (info.activeProducts.length === 0) throw new ImportError('NO_ACTIVE_PRODUCT', 'Create at least one active product before importing bottle movement.');
      if (!productId) {
        if (info.activeProducts.length === 1) productId = info.activeProducts[0].id;
        else throw new ImportError('PRODUCT_REQUIRED', 'Choose which product the bottle movement in this file belongs to.');
      }
      if (!info.activeProducts.some((p) => p.id === productId)) {
        throw new ImportError('PRODUCT_REQUIRED', 'The selected product is not an active product of this vendor.');
      }
    } else {
      productId = null;
    }

    return { cutoverDate, reportingMode, productId, dateOrder: o['dateOrder'] === 'DMY' ? 'DMY' : 'MDY', reportsAcknowledged };
  },

  profileOptionDefaults: (o) => ({ dateOrder: o.dateOrder, reportingMode: o.reportingMode }),

  normalizeRow(raw: RawRow, mapping: ImportMapping, options): NormalizedRowResult<NormalizedVoucher> {
    const headers = fieldHeaders(mapping);
    const cell = (key: string) => (headers[key] === undefined ? undefined : raw[headers[key]]);
    const issues: RowIssue[] = [];

    const customerCode = parseText(cell('customerCode') as never);
    if (!customerCode) {
      issues.push(err('CODE_REQUIRED', 'Customer code is missing.', 'customerCode'));
      return { normalized: null, issues };
    }
    if (customerCode.length > 64) {
      issues.push(err('CODE_INVALID', 'Customer code is too long.', 'customerCode'));
      return { normalized: null, issues };
    }

    const date = parseVoucherDate(cell('date') as RawCell, options.dateOrder);
    if (!date) issues.push(err('DATE_INVALID', `Date "${String(cell('date') ?? '')}" is missing or not a valid date.`, 'date'));

    const money = (key: string, label: string): number | null => {
      if (headers[key] === undefined) return 0;
      const r = parseMoney(cell(key) as never);
      if (!r.ok) {
        issues.push(err('INVALID_NUMBER', `${label} "${String(cell(key))}" is not a valid amount.`, key));
        return 0;
      }
      return r.value;
    };
    const whole = (key: string, label: string): number | null => {
      if (headers[key] === undefined) return 0;
      const r = parseWholeNumber(cell(key) as never);
      if (!r.ok) {
        issues.push(err('INVALID_NUMBER', `${label} "${String(cell(key))}" is not a whole number.`, key));
        return 0;
      }
      return r.value;
    };
    const optMoney = (key: string, label: string): number | null => {
      if (headers[key] === undefined) return null;
      const r = parseMoney(cell(key) as never);
      if (!r.ok) {
        issues.push(err('INVALID_NUMBER', `${label} "${String(cell(key))}" is not a valid amount.`, key));
        return null;
      }
      return r.value;
    };
    const optWhole = (key: string, label: string): number | null => {
      if (headers[key] === undefined) return null;
      const r = parseWholeNumber(cell(key) as never);
      if (!r.ok) {
        issues.push(err('INVALID_NUMBER', `${label} "${String(cell(key))}" is not a whole number.`, key));
        return null;
      }
      return r.value;
    };

    const charge = money('charge', 'Charge') ?? 0;
    const paid = money('paid', 'Paid') ?? 0;
    const filled = whole('filled', 'Filled') ?? 0;
    const empty = whole('empty', 'Empty') ?? 0;
    const outstandingAfter = optMoney('outstandingAfter', 'Outstanding');
    const bottleBalanceAfter = optWhole('bottleBalanceAfter', 'Bottle balance');

    if (charge < 0) issues.push(warn('NEGATIVE_CHARGE', 'Charge is negative - it will be posted as a credit.', 'charge'));
    if (paid < 0) issues.push(warn('NEGATIVE_PAID', 'Payment is negative - it will be posted as a refund.', 'paid'));
    if (filled < 0 || empty < 0) issues.push(warn('NEGATIVE_BOTTLES', 'A bottle count is negative.', filled < 0 ? 'filled' : 'empty'));

    const voucher = parseText(cell('voucher') as never);
    const valid = !issues.some((i) => i.severity === 'ERROR');
    return {
      normalized: { valid, customerCode, voucher, date, filled, empty, charge, paid, outstandingAfter, bottleBalanceAfter },
      issues,
    };
  },

  async loadContext(prisma: PrismaService, vendorId: string, options, rows = []): Promise<HistoryContext> {
    const normalized = rows as { rowNumber: number; normalized: NormalizedVoucher | null }[];
    const codes = [...new Set(normalized.map((r) => r.normalized?.customerCode).filter((c): c is string => !!c))];

    const customers = new Map<string, CustomerFacts>();
    for (const part of chunk(codes, 5000)) {
      const found = await prisma.customer.findMany({
        where: { vendorId, customerCode: { in: part } },
        select: {
          id: true,
          customerCode: true,
          isActive: true,
          financialBalance: true,
          wallets: options.productId ? { where: { productId: options.productId }, select: { balance: true } } : false,
        },
      });
      for (const c of found) {
        const wallets = (c as unknown as { wallets?: { balance: number }[] }).wallets;
        customers.set(c.customerCode, {
          id: c.id,
          isActive: c.isActive,
          financialBalance: c.financialBalance,
          walletBalance: wallets && wallets.length ? wallets[0].balance : null,
        });
      }
    }

    // Live activity AFTER the cutover day is already inside financialBalance / the wallet; the file
    // must reconcile with the balance AT the cutover, i.e. the statement's own "balance on day D" maths.
    const end = cutoverEndUtc(options.cutoverDate);
    const postMoney = new Map<string, number>();
    const postBottles = new Map<string, number>();
    const ids = [...customers.values()].map((c) => c.id);
    for (const part of chunk(ids, 5000)) {
      const money = await prisma.transaction.groupBy({
        by: ['customerId'],
        where: { vendorId, customerId: { in: part }, createdAt: { gte: end } },
        _sum: { amount: true },
      });
      for (const m of money) if (m.customerId) postMoney.set(m.customerId, m._sum.amount ?? 0);
      if (options.productId) {
        const bottles = await prisma.transaction.groupBy({
          by: ['customerId'],
          where: { vendorId, customerId: { in: part }, productId: options.productId, bottleCount: { not: null }, createdAt: { gte: end } },
          _sum: { bottleCount: true },
        });
        for (const b of bottles) if (b.customerId) postBottles.set(b.customerId, b._sum.bottleCount ?? 0);
      }
    }

    const keys = computeDedupeKeys(vendorId, normalized);
    const existingKeys = new Set<string>();
    for (const part of chunk([...keys.values()], 5000)) {
      const hits = await prisma.importRow.findMany({
        where: { dedupeKey: { in: part }, result: 'CREATED', batch: { vendorId } },
        select: { dedupeKey: true },
      });
      for (const h of hits) if (h.dedupeKey) existingKeys.add(h.dedupeKey);
    }

    return { customers, postMoney, postBottles, existingKeys, keys };
  },

  validateAndPlan(rows, ctx, options): PlannedRow<NormalizedVoucher>[] {
    const planned = new Map<number, PlannedRow<NormalizedVoucher>>();
    const byCustomer = new Map<string, PlanEntry[]>();

    const finish = (e: PlanEntry) => {
      planned.set(e.row.rowNumber, { rowNumber: e.row.rowNumber, normalized: e.n, issues: e.issues, action: e.action, dedupeKey: e.key });
    };

    for (const row of rows) {
      const n = row.normalized;
      const entry: PlanEntry = { row, issues: [...row.issues], n: n ? { ...n } : null, key: ctx.keys.get(row.rowNumber) ?? null, skip: null, action: 'SKIP_INVALID' };
      if (!n) {
        finish(entry); // no customer code - no chain to protect
        continue;
      }
      const list = byCustomer.get(n.customerCode);
      if (list) list.push(entry);
      else byCustomer.set(n.customerCode, [entry]);
    }

    const paise = (x: number) => Math.round(x * 100);

    for (const [code, list] of byCustomer) {
      const cust = ctx.customers.get(code);
      if (!cust) {
        for (const e of list) {
          e.issues.push(err('UNKNOWN_CUSTOMER', `No customer with code "${code}" exists - this row was skipped.`, 'customerCode'));
          finish(e);
        }
        continue;
      }

      // Rows after the cutover are errors but sit OUTSIDE the chain: they do not block the customer.
      const outside = new Set<PlanEntry>();
      for (const e of list) {
        if (e.n?.date && e.n.date > options.cutoverDate) {
          e.issues.push(err('AFTER_CUTOVER', `Dated ${e.n.date}, after the cutover date ${options.cutoverDate} - live data owns that period.`, 'date'));
          outside.add(e);
        }
      }
      const chain = list.filter((e) => !outside.has(e));
      for (const e of outside) finish(e);

      const firstError = chain.find((e) => e.issues.some((i) => i.severity === 'ERROR'));
      if (firstError) {
        for (const e of chain) {
          if (e !== firstError && !e.issues.some((i) => i.severity === 'ERROR')) {
            e.issues.push(err('CHAIN_BLOCKED', `Row ${firstError.row.rowNumber} of this customer has an error, so none of the customer's history was imported (a partial history would break the statement).`));
          }
          finish(e);
        }
        continue;
      }

      chain.sort((a, b) => ((a.n as NormalizedVoucher).date as string).localeCompare((b.n as NormalizedVoucher).date as string) || a.row.rowNumber - b.row.rowNumber);

      const seen = new Set<string>();
      for (const e of chain) {
        const n = e.n as NormalizedVoucher;
        if (e.key && seen.has(e.key)) {
          e.skip = 'DUP';
          e.issues.push(warn('DUPLICATE_IN_FILE', 'The same voucher appears more than once in the file - this copy was skipped.'));
        } else if (e.key && ctx.existingKeys.has(e.key)) {
          e.skip = 'EXISTING';
          e.issues.push(warn('ALREADY_IMPORTED', 'This voucher was already imported - skipped, nothing was changed.'));
        } else if (!hasMovement(n)) {
          e.skip = 'NOOP';
          e.issues.push(warn('NO_MOVEMENT', 'No charge, payment or bottle movement on this voucher - nothing to post.'));
        }
        if (e.key) seen.add(e.key);
      }

      const postable = chain.filter((e) => !e.skip);
      for (const e of chain) {
        e.action = e.skip ? 'SKIP_EXISTING' : 'CREATE';
      }
      if (postable.length === 0) {
        for (const e of chain) finish(e);
        continue;
      }

      // ── reconciliation: the chain's final balances must equal the customer's balance at cutover ──
      const last = [...chain].reverse().find((e) => e.skip !== 'DUP') as PlanEntry;
      const ln = last.n as NormalizedVoucher;
      const expectedMoney = Math.round((cust.financialBalance - (ctx.postMoney.get(cust.id) ?? 0)) * 100) / 100;
      const expectedBottles = cust.walletBalance === null ? null : cust.walletBalance - (ctx.postBottles.get(cust.id) ?? 0);

      let mismatch: RowIssue | null = null;
      if (ln.outstandingAfter !== null && paise(ln.outstandingAfter) !== paise(expectedMoney)) {
        mismatch = err(
          'BALANCE_MISMATCH',
          `The file ends at ${ln.outstandingAfter.toFixed(2)} but this customer's balance at the cutover is ${expectedMoney.toFixed(2)}. None of this customer's history was imported.`,
          'outstandingAfter',
          { kind: 'MONEY', expected: expectedMoney, file: ln.outstandingAfter },
        );
      } else if (options.productId && ln.bottleBalanceAfter !== null && expectedBottles !== null && ln.bottleBalanceAfter !== expectedBottles) {
        mismatch = err(
          'BALANCE_MISMATCH',
          `The file ends with ${ln.bottleBalanceAfter} bottles but this customer's bottle balance at the cutover is ${expectedBottles}. None of this customer's history was imported.`,
          'bottleBalanceAfter',
          { kind: 'BOTTLES', expected: expectedBottles, file: ln.bottleBalanceAfter },
        );
      }
      if (mismatch) {
        postable.forEach((e, i) => {
          e.issues.push(i === 0 ? mismatch as RowIssue : err('CHAIN_BLOCKED', `Balance mismatch on row ${postable[0].row.rowNumber} - this customer's history was not imported.`));
          e.action = 'SKIP_INVALID';
          e.skip = null;
        });
        for (const e of chain) finish(e);
        continue;
      }

      // ── soft checks (warnings, first one per customer only) ──
      let chainWarned = false;
      const counted = chain.filter((e) => e.skip !== 'DUP');
      for (let i = 1; i < counted.length && !chainWarned; i++) {
        const prev = counted[i - 1].n as NormalizedVoucher;
        const cur = counted[i].n as NormalizedVoucher;
        if (prev.outstandingAfter !== null && cur.outstandingAfter !== null && paise(prev.outstandingAfter + cur.charge - cur.paid) !== paise(cur.outstandingAfter)) {
          counted[i].issues.push(warn('CHAIN_BREAK', 'The running balance does not follow from the previous voucher (previous balance + charge - paid). The file may be missing a voucher or contain an adjustment.', 'outstandingAfter'));
          chainWarned = true;
        } else if (prev.bottleBalanceAfter !== null && cur.bottleBalanceAfter !== null && prev.bottleBalanceAfter + cur.filled - cur.empty !== cur.bottleBalanceAfter) {
          counted[i].issues.push(warn('CHAIN_BREAK', 'The running bottle balance does not follow from the previous voucher.', 'bottleBalanceAfter'));
          chainWarned = true;
        }
      }
      if (ln.outstandingAfter === null) {
        const net = counted.reduce((s, e) => s + (e.n as NormalizedVoucher).charge - (e.n as NormalizedVoucher).paid, 0);
        const implied = Math.round((expectedMoney - net) * 100) / 100;
        postable[0].issues.push(warn('NO_RUNNING_BALANCE', `No running balance in the file, so it could not be checked. Balance before this history = current balance - history = ${implied.toFixed(2)}.`, 'outstandingAfter', { implied }));
      }
      if (!cust.isActive) postable[0].issues.push(warn('CUSTOMER_INACTIVE', 'This customer is inactive - history is still imported.'));

      const reconcile = { finalOutstanding: ln.outstandingAfter, finalBottles: ln.bottleBalanceAfter };
      for (const e of postable) (e.n as NormalizedVoucher).reconcile = reconcile;
      for (const e of chain) finish(e);
    }

    return [...planned.values()].sort((a, b) => a.rowNumber - b.rowNumber);
  },

  summarize(planned, options): PlanSummary {
    const s: PlanSummary = {
      total: planned.length,
      create: 0,
      skipExisting: 0,
      skipInvalid: 0,
      rowsWithWarnings: 0,
      sumOpeningBalancePaise: 0,
      sumOpeningBottles: 0,
    };
    const inFile = new Set<string>();
    const toImport = new Set<string>();
    const blocked = new Set<string>();
    const unknown = new Set<string>();
    const mismatches: HistoryPlanSummary['mismatches'] = [];
    let chargeRows = 0;
    let paymentRows = 0;
    let sumCharge = 0;
    let sumPaid = 0;
    let bottlesOut = 0;
    let bottlesIn = 0;
    let noMovement = 0;
    let alreadyImported = 0;
    let duplicateInFile = 0;
    let afterCutover = 0;
    let withoutRunning = 0;
    let dateFrom: string | null = null;
    let dateTo: string | null = null;
    const has = (p: { issues: RowIssue[] }, code: string) => p.issues.some((i) => i.code === code);

    for (const p of planned) {
      const n = p.normalized;
      if (n) inFile.add(n.customerCode);
      if (p.action === 'CREATE' && n) {
        s.create++;
        toImport.add(n.customerCode);
        if (p.issues.some((i) => i.severity === 'WARNING')) s.rowsWithWarnings++;
        if (n.charge !== 0 || n.filled !== 0 || n.empty !== 0) chargeRows++;
        if (n.paid !== 0) paymentRows++;
        sumCharge += toPaise(n.charge);
        sumPaid += toPaise(n.paid);
        bottlesOut += n.filled;
        bottlesIn += n.empty;
        if (n.date) {
          if (!dateFrom || n.date < dateFrom) dateFrom = n.date;
          if (!dateTo || n.date > dateTo) dateTo = n.date;
        }
        if (has(p, 'NO_RUNNING_BALANCE')) withoutRunning++;
      } else if (p.action === 'SKIP_EXISTING') {
        s.skipExisting++;
        if (has(p, 'NO_MOVEMENT')) noMovement++;
        if (has(p, 'ALREADY_IMPORTED')) alreadyImported++;
        if (has(p, 'DUPLICATE_IN_FILE')) duplicateInFile++;
      } else {
        s.skipInvalid++;
      }
      if (has(p, 'AFTER_CUTOVER')) afterCutover++;
      if (has(p, 'UNKNOWN_CUSTOMER') && n) unknown.add(n.customerCode);
      if ((has(p, 'BALANCE_MISMATCH') || has(p, 'CHAIN_BLOCKED')) && n) blocked.add(n.customerCode);
      const mm = p.issues.find((i) => i.code === 'BALANCE_MISMATCH');
      if (mm && n && mismatches.length < 50) {
        mismatches.push({ code: n.customerCode, expected: (mm.data?.['expected'] as number) ?? null, file: (mm.data?.['file'] as number) ?? null, kind: mm.data?.['kind'] === 'BOTTLES' ? 'BOTTLES' : 'MONEY' });
      }
    }

    const notices: string[] = [];
    const cutover = options?.cutoverDate ?? '';
    const mode: ReportingMode = options?.reportingMode ?? 'STATEMENT_ONLY';
    if (cutover) {
      const today = todayPkt();
      const twoMonthsAgo = new Date(Date.parse(`${today.slice(0, 7)}-01T00:00:00Z`));
      twoMonthsAgo.setUTCMonth(twoMonthsAgo.getUTCMonth() - 1);
      if (cutover >= twoMonthsAgo.toISOString().slice(0, 10)) {
        notices.push('The cutover is within the last two months. Month-based balance reminders treat imported payments as non-payments for that window - prefer an earlier cutover if reminders are in use.');
      }
    }
    if (mode === 'COUNT_IN_REPORTS') {
      notices.push('Reports mode: imported deliveries/payments appear as normal DELIVERY/PAYMENT rows. Old months show Received and customer-level sales but NO expenses/cost, and the P&L Sale line (which needs a daily sheet) will not include them.');
    }

    s.history = {
      reportingMode: mode,
      cutoverDate: cutover,
      dateFrom,
      dateTo,
      customersInFile: inFile.size,
      customersToImport: toImport.size,
      customersBlocked: blocked.size,
      unknownCodes: unknown.size,
      unknownCodeList: [...unknown].slice(0, 200),
      mismatches,
      chargeRows,
      paymentRows,
      sumChargePaise: sumCharge,
      sumPaidPaise: sumPaid,
      bottlesOut,
      bottlesIn,
      noMovement,
      alreadyImported,
      duplicateInFile,
      afterCutover,
      withoutRunningBalance: withoutRunning,
      notices,
    };
    return s;
  },

  async prepareExecution(_prisma, _vendorId, _rows, _options, batchId): Promise<HistoryExec> {
    return { batchId: batchId ?? null };
  },

  async executeRow(): Promise<ExecOutcome> {
    // Never used: history executes per customer (executeGroup).
    return { result: 'FAILED', resultCode: 'NOT_SUPPORTED', resultMessage: 'Row-level execution is not supported for this import.' };
  },

  groupKey: (n) => n.customerCode,

  async executeGroup(prisma: PrismaService, vendorId: string, rows: GroupRow<NormalizedVoucher>[], exec, options, recordMany): Promise<GroupRowOutcome[]> {
    const code = rows[0].normalized.customerCode;
    const all = (outcome: ExecOutcome): GroupRowOutcome[] => rows.map((r) => ({ rowId: r.rowId, outcome }));
    const chargeType = options.reportingMode === 'COUNT_IN_REPORTS' ? TransactionType.DELIVERY : TransactionType.HISTORICAL;
    const paymentType = options.reportingMode === 'COUNT_IN_REPORTS' ? TransactionType.PAYMENT : TransactionType.HISTORICAL;
    const end = cutoverEndUtc(options.cutoverDate);

    try {
      return await prisma.$transaction(
        async (tx) => {
          const cust = await tx.customer.findUnique({
            where: { vendorId_customerCode: { vendorId, customerCode: code } },
            select: {
              id: true,
              financialBalance: true,
              wallets: options.productId ? { where: { productId: options.productId }, select: { balance: true } } : false,
            },
          });
          if (!cust) return all({ result: 'SKIPPED', resultCode: 'CUSTOMER_NOT_FOUND', resultMessage: `Customer "${code}" no longer exists - skipped.` });

          // Re-check idempotency at write time (another batch may have imported the same vouchers).
          const keys = rows.map((r) => (r as GroupRow<NormalizedVoucher> & { dedupeKey?: string | null }).dedupeKey).filter((k): k is string => !!k);
          const taken = new Set<string>();
          if (keys.length) {
            const hits = await tx.importRow.findMany({
              where: { dedupeKey: { in: keys }, result: 'CREATED', batch: { vendorId }, ...(exec.batchId ? { batchId: { not: exec.batchId } } : {}) },
              select: { dedupeKey: true },
            });
            for (const h of hits) if (h.dedupeKey) taken.add(h.dedupeKey);
          }
          const fresh = rows.filter((r) => !taken.has((r as GroupRow<NormalizedVoucher> & { dedupeKey?: string | null }).dedupeKey ?? ''));
          const duplicates: GroupRowOutcome[] = rows
            .filter((r) => !fresh.includes(r))
            .map((r) => ({ rowId: r.rowId, outcome: { result: 'SKIPPED', resultCode: 'ALREADY_IMPORTED', resultMessage: 'This voucher was already imported - skipped.' } as ExecOutcome }));
          if (fresh.length === 0) return duplicates;

          // Re-check reconciliation: the customer's balance may have moved since the plan was built.
          const rec = fresh[0].normalized.reconcile;
          if (rec) {
            const postMoney = (await tx.transaction.aggregate({ where: { vendorId, customerId: cust.id, createdAt: { gte: end } }, _sum: { amount: true } }))._sum.amount ?? 0;
            const expectedMoney = Math.round((cust.financialBalance - postMoney) * 100) / 100;
            let drifted = rec.finalOutstanding !== null && Math.round(rec.finalOutstanding * 100) !== Math.round(expectedMoney * 100);
            if (!drifted && options.productId && rec.finalBottles !== null) {
              const wallets = (cust as unknown as { wallets?: { balance: number }[] }).wallets;
              if (wallets && wallets.length) {
                const postBottles =
                  (await tx.transaction.aggregate({ where: { vendorId, customerId: cust.id, productId: options.productId, bottleCount: { not: null }, createdAt: { gte: end } }, _sum: { bottleCount: true } }))._sum.bottleCount ?? 0;
                drifted = rec.finalBottles !== wallets[0].balance - postBottles;
              }
            }
            if (drifted) {
              return [
                ...duplicates,
                ...fresh.map((r) => ({ rowId: r.rowId, outcome: { result: 'SKIPPED', resultCode: 'BALANCE_CHANGED', resultMessage: "The customer's balance changed after the preview - nothing was imported for this customer. Re-run the preview." } as ExecOutcome })),
              ];
            }
          }

          const ordered = [...fresh].sort((a, b) => ((a.normalized.date as string).localeCompare(b.normalized.date as string)) || a.rowNumber - b.rowNumber);
          const perDay = new Map<string, number>();
          const data: Prisma.TransactionCreateManyInput[] = [];
          const items: GroupRowOutcome[] = [];
          for (const r of ordered) {
            const n = r.normalized;
            const date = n.date as string;
            const slot = perDay.get(date) ?? 0;
            perDay.set(date, slot + 1);
            const txIds: string[] = [];
            if (n.charge !== 0 || n.filled !== 0 || n.empty !== 0) {
              const id = randomUUID();
              txIds.push(id);
              const bottles = n.filled !== 0 || n.empty !== 0;
              data.push({
                id,
                type: chargeType,
                vendorId,
                customerId: cust.id,
                productId: bottles || options.productId ? options.productId : null,
                amount: n.charge,
                filledDropped: n.filled,
                emptyReceived: n.empty,
                filledReceived: 0,
                bottleCount: n.filled - n.empty,
                description: bottles ? `Delivered ${n.filled}, Received ${n.empty}` : n.charge >= 0 ? 'Charge' : 'Credit',
                createdAt: voucherInstant(date, slot * 2),
              });
            }
            if (n.paid !== 0) {
              const id = randomUUID();
              txIds.push(id);
              data.push({
                id,
                type: paymentType,
                vendorId,
                customerId: cust.id,
                amount: -n.paid,
                description: n.paid > 0 ? 'Payment received' : 'Payment refunded',
                createdAt: voucherInstant(date, slot * 2 + 1),
              });
            }
            items.push({
              rowId: r.rowId,
              outcome: {
                result: 'CREATED',
                entityType: 'Transaction',
                entityId: txIds[0],
                appliedSnapshot: {
                  txIds,
                  customerId: cust.id,
                  reportingMode: options.reportingMode,
                  financialBalanceAfter: n.outstandingAfter,
                  bottleBalanceAfter: n.bottleBalanceAfter,
                } as Prisma.InputJsonValue,
              },
            });
          }
          if (data.length) await tx.transaction.createMany({ data });
          await recordMany(tx, items);
          return [...duplicates, ...items];
        },
        { maxWait: 10_000, timeout: 120_000 },
      );
    } catch (e) {
      return all({ result: 'FAILED', resultCode: 'DB_ERROR', resultMessage: "This customer's history could not be saved. It can be retried with Resume.", cause: e });
    }
  },

  revertRows: revertHistoryRows,

  templateSample() {
    return {
      headers: ['Customer Code', 'Voucher', 'Date', 'Filled', 'Empty', 'Bottle Balance After', 'Charge', 'Paid', 'Outstanding After'],
      example: ['C001', 10234, '2025-01-05', 2, 1, 3, 440, 200, 1740],
    };
  },
};
