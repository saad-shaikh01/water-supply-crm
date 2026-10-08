import { parseHtmlTable, decodeEntities } from '../pipeline/html-table-parser';
import {
  HISTORY_HTML_HEADERS,
  computeDedupeKeys,
  cutoverEndUtc,
  parseVoucherDate,
  transactionHistoryDefinition as def,
  voucherInstant,
  type HistoryOptions,
  type NormalizedVoucher,
} from './transaction-history.definition';
import type { ImportMapping } from '../import.types';

const OPTS: HistoryOptions = { cutoverDate: '2025-12-31', reportingMode: 'STATEMENT_ONLY', productId: 'p1', dateOrder: 'MDY', reportsAcknowledged: false };

const MAPPING: ImportMapping = {
  columns: Object.fromEntries(HISTORY_HTML_HEADERS.map((h, i) => [h, ['customerCode', 'voucher', 'date', 'filled', 'empty', 'bottleBalanceAfter', 'charge', 'paid', 'outstandingAfter'][i]])),
  valueMaps: {},
};

function v(over: Partial<NormalizedVoucher> & { customerCode: string; date: string }): NormalizedVoucher {
  return { valid: true, voucher: null, filled: 0, empty: 0, charge: 0, paid: 0, outstandingAfter: null, bottleBalanceAfter: null, ...over };
}

function ctxFor(rows: { rowNumber: number; normalized: NormalizedVoucher | null }[], customers: Record<string, { fin: number; bottles?: number | null }>, extra: { existingKeys?: string[]; postMoney?: Record<string, number> } = {}) {
  const map = new Map(
    Object.entries(customers).map(([code, c]) => [code, { id: `id-${code}`, isActive: true, financialBalance: c.fin, walletBalance: c.bottles ?? null }]),
  );
  return {
    customers: map,
    postMoney: new Map(Object.entries(extra.postMoney ?? {}).map(([c, n]) => [`id-${c}`, n])),
    postBottles: new Map<string, number>(),
    existingKeys: new Set(extra.existingKeys ?? []),
    keys: computeDedupeKeys('vendor-1', rows),
  };
}

function plan(rows: NormalizedVoucher[], customers: Record<string, { fin: number; bottles?: number | null }>, extra = {}) {
  const input = rows.map((n, i) => ({ rowNumber: i + 1, normalized: n, issues: n.valid ? [] : [{ severity: 'ERROR' as const, code: 'INVALID_NUMBER', message: 'bad' }] }));
  const ctx = ctxFor(input, customers, extra);
  return def.validateAndPlan(input, ctx, OPTS);
}

describe('html-table-parser', () => {
  it('decodes numeric entities and keeps only 13-cell data rows', () => {
    const cell = (t: string) => `<TD DIR=LTR>${t}</TD>`;
    const row = (cells: string[]) => `<TR>${cells.map(cell).join('')}</TR>\r\n`;
    const html =
      '<HTML><BODY><TABLE>' +
      row(['&#72;&#48;&#51;', '1001', '1/5/2025', '2', '1', '3', '440', '200', '1740', '0', '0', '', '']) +
      '<TR><TD>caption only</TD></TR>' +
      row(['', '1002', '1/6/2025', '1', '0', '3', '0', '0', '1740', '0', '0', '', '']) +
      '</TABLE></BODY></HTML>';
    const out = parseHtmlTable(Buffer.from(html, 'latin1'), { headers: HISTORY_HTML_HEADERS }, { maxRows: 100, maxCellChars: 500 });
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].values['Customer Code']).toBe('H03');
    expect(out.rows[0].values['Charge']).toBe('440');
    expect(out.headers).toEqual(HISTORY_HTML_HEADERS);
  });

  it('enforces the row cap and rejects a file with no table', () => {
    const row = '<TR><TD>A</TD><TD>1</TD><TD>1/1/2025</TD><TD>0</TD><TD>0</TD><TD>0</TD><TD>0</TD><TD>0</TD><TD>0</TD></TR>';
    expect(() => parseHtmlTable(Buffer.from(row.repeat(3)), { headers: HISTORY_HTML_HEADERS }, { maxRows: 2, maxCellChars: 500 })).toThrow(/more than 2 rows/);
    expect(() => parseHtmlTable(Buffer.from('<p>nothing</p>'), { headers: HISTORY_HTML_HEADERS }, { maxRows: 2, maxCellChars: 500 })).toThrow();
  });

  it('decodeEntities handles hex, named and unknown references', () => {
    expect(decodeEntities('&#x48;&amp;&nbsp;&bogus;')).toBe('H& &bogus;');
  });
});

describe('dates', () => {
  it('parses M/D/YYYY, D/M/YYYY, ISO and Excel serials; rejects impossible dates', () => {
    expect(parseVoucherDate('1/31/2025', 'MDY')).toBe('2025-01-31');
    expect(parseVoucherDate('31/1/2025', 'DMY')).toBe('2025-01-31');
    expect(parseVoucherDate('2025-02-03', 'MDY')).toBe('2025-02-03');
    expect(parseVoucherDate(45658, 'MDY')).toBe('2025-01-01');
    expect(parseVoucherDate('2/30/2025', 'MDY')).toBeNull();
    expect(parseVoucherDate('13/1/2025', 'MDY')).toBeNull();
    expect(parseVoucherDate('', 'MDY')).toBeNull();
  });

  it('stores a voucher at 12:00 PKT and ends the cutover at the next PKT midnight', () => {
    expect(voucherInstant('2025-03-01', 0).toISOString()).toBe('2025-03-01T07:00:00.000Z');
    expect(voucherInstant('2025-03-01', 3).toISOString()).toBe('2025-03-01T07:00:03.000Z');
    expect(cutoverEndUtc('2025-12-31').toISOString()).toBe('2025-12-31T19:00:00.000Z');
  });
});

describe('parseOptions', () => {
  const info = (mapped: string[], products = 1) => ({
    mappedFieldKeys: new Set(mapped),
    activeProducts: Array.from({ length: products }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}`, basePrice: 100 })),
  });

  it('requires a cutover date that is not in the future', () => {
    expect(() => def.parseOptions({}, info(['charge']))).toThrow(/cutover/i);
    expect(() => def.parseOptions({ cutoverDate: '2999-01-01' }, info(['charge']))).toThrow(/future/);
    expect(def.parseOptions({ cutoverDate: '2025-12-31' }, info(['charge'])).reportingMode).toBe('STATEMENT_ONLY');
  });

  it('reports mode needs the acknowledgement and a cutover before this month', () => {
    expect(() => def.parseOptions({ cutoverDate: '2025-12-31', reportingMode: 'COUNT_IN_REPORTS' }, info(['charge']))).toThrow(/confirmation/);
    expect(def.parseOptions({ cutoverDate: '2025-12-31', reportingMode: 'COUNT_IN_REPORTS', reportsAcknowledged: true }, info(['charge'])).reportingMode).toBe('COUNT_IN_REPORTS');
    const today = new Date().toISOString().slice(0, 10);
    expect(() => def.parseOptions({ cutoverDate: today, reportingMode: 'COUNT_IN_REPORTS', reportsAcknowledged: true }, info(['charge']))).toThrow(/before the first day/);
  });

  it('needs a product only when bottle fields are mapped', () => {
    expect(def.parseOptions({ cutoverDate: '2025-12-31' }, info(['charge'], 2)).productId).toBeNull();
    expect(() => def.parseOptions({ cutoverDate: '2025-12-31' }, info(['filled'], 2))).toThrow(/Choose which product/);
    expect(def.parseOptions({ cutoverDate: '2025-12-31' }, info(['filled'], 1)).productId).toBe('p1');
  });
});

describe('normalizeRow', () => {
  const raw = (o: Record<string, string | null>) => ({ 'Customer Code': 'H1', Voucher: '10', Date: '1/5/2025', Filled: '2', Empty: '1', 'Bottle Balance After': '3', Charge: '440', Paid: '200', 'Outstanding After': '1740', ...o });

  it('reads a normal voucher', () => {
    const r = def.normalizeRow(raw({}), MAPPING, OPTS);
    expect(r.issues).toEqual([]);
    expect(r.normalized).toMatchObject({ customerCode: 'H1', voucher: '10', date: '2025-01-05', filled: 2, empty: 1, charge: 440, paid: 200, outstandingAfter: 1740, bottleBalanceAfter: 3 });
  });

  it('flags a bad date / number as ERROR but keeps the customer code so the chain can be blocked', () => {
    const r = def.normalizeRow(raw({ Date: 'soon', Charge: 'abc' }), MAPPING, OPTS);
    expect(r.normalized?.valid).toBe(false);
    expect(r.normalized?.customerCode).toBe('H1');
    expect(r.issues.map((i) => i.code).sort()).toEqual(['DATE_INVALID', 'INVALID_NUMBER']);
  });

  it('a missing customer code has no chain (normalized null)', () => {
    expect(def.normalizeRow(raw({ 'Customer Code': null }), MAPPING, OPTS).normalized).toBeNull();
  });

  it('warns on negative amounts instead of blocking', () => {
    const r = def.normalizeRow(raw({ Charge: '-50', Paid: '-10' }), MAPPING, OPTS);
    expect(r.issues.every((i) => i.severity === 'WARNING')).toBe(true);
  });
});

describe('dedupe keys', () => {
  it('gives identical same-day vouchers without a voucher number an ordinal, but not with one', () => {
    const a = v({ customerCode: 'H1', date: '2025-01-05', filled: 1, charge: 100 });
    const withNo = v({ customerCode: 'H1', date: '2025-01-05', filled: 1, charge: 100, voucher: '77' });
    const keys = computeDedupeKeys('vendor-1', [
      { rowNumber: 1, normalized: a },
      { rowNumber: 2, normalized: a },
      { rowNumber: 3, normalized: withNo },
      { rowNumber: 4, normalized: withNo },
    ]);
    expect(keys.get(1)).not.toBe(keys.get(2));
    expect(keys.get(1)?.endsWith('#1')).toBe(true);
    expect(keys.get(3)).toBe(keys.get(4)); // same voucher + content = a duplicate
    expect(computeDedupeKeys('vendor-2', [{ rowNumber: 1, normalized: a }]).get(1)).not.toBe(keys.get(1)); // vendor-scoped
  });
});

describe('validateAndPlan', () => {
  const rows = [
    v({ customerCode: 'H1', date: '2025-01-05', voucher: '1', filled: 2, empty: 0, charge: 400, paid: 0, outstandingAfter: 400, bottleBalanceAfter: 2 }),
    v({ customerCode: 'H1', date: '2025-01-09', voucher: '2', filled: 0, empty: 0, charge: 0, paid: 150, outstandingAfter: 250, bottleBalanceAfter: 2 }),
  ];

  it('creates every row when the final file balance equals the customer balance', () => {
    const out = plan(rows, { H1: { fin: 250, bottles: 2 } });
    expect(out.map((p) => p.action)).toEqual(['CREATE', 'CREATE']);
    expect(out[0].normalized?.reconcile).toEqual({ finalOutstanding: 250, finalBottles: 2 });
    expect(out[0].dedupeKey).toBeTruthy();
  });

  it('reconciles against the balance AT cutover when live activity happened afterwards', () => {
    // customer owes 250 at cutover, then +100 of live charges: balance now 350
    const out = plan(rows, { H1: { fin: 350, bottles: 2 } }, { postMoney: { H1: 100 } });
    expect(out.map((p) => p.action)).toEqual(['CREATE', 'CREATE']);
  });

  it('skips the WHOLE customer chain on a money mismatch and reports expected vs file', () => {
    const out = plan(rows, { H1: { fin: 999, bottles: 2 } });
    expect(out.map((p) => p.action)).toEqual(['SKIP_INVALID', 'SKIP_INVALID']);
    const mm = out[0].issues.find((i) => i.code === 'BALANCE_MISMATCH');
    expect(mm?.data).toMatchObject({ kind: 'MONEY', expected: 999, file: 250 });
    expect(out[1].issues.map((i) => i.code)).toContain('CHAIN_BLOCKED');
  });

  it('skips the chain on a bottle-balance mismatch', () => {
    const out = plan(rows, { H1: { fin: 250, bottles: 7 } });
    expect(out.every((p) => p.action === 'SKIP_INVALID')).toBe(true);
    expect(out[0].issues.find((i) => i.code === 'BALANCE_MISMATCH')?.data).toMatchObject({ kind: 'BOTTLES' });
  });

  it('unknown customer codes are skipped with a clear error and never affect others', () => {
    const out = plan([...rows, v({ customerCode: 'NOPE', date: '2025-01-05', charge: 5 })], { H1: { fin: 250, bottles: 2 } });
    expect(out[2].action).toBe('SKIP_INVALID');
    expect(out[2].issues[0].code).toBe('UNKNOWN_CUSTOMER');
    expect(out[0].action).toBe('CREATE');
  });

  it('a row error blocks only that customer', () => {
    const bad = v({ customerCode: 'H1', date: '2025-01-06', valid: false });
    const out = plan([rows[0], bad, rows[1], v({ customerCode: 'H2', date: '2025-01-05', charge: 10, paid: 0, outstandingAfter: 10 })], { H1: { fin: 250, bottles: 2 }, H2: { fin: 10 } });
    expect(out.map((p) => p.action)).toEqual(['SKIP_INVALID', 'SKIP_INVALID', 'SKIP_INVALID', 'CREATE']);
    expect(out[0].issues.map((i) => i.code)).toContain('CHAIN_BLOCKED');
  });

  it('rows after the cutover are errors but do not block the customer', () => {
    const late = v({ customerCode: 'H1', date: '2026-02-01', charge: 90, outstandingAfter: 340 });
    const out = plan([...rows, late], { H1: { fin: 250, bottles: 2 } });
    expect(out.map((p) => p.action)).toEqual(['CREATE', 'CREATE', 'SKIP_INVALID']);
    expect(out[2].issues.map((i) => i.code)).toContain('AFTER_CUTOVER');
  });

  it('is idempotent: rows already imported by an earlier batch are skipped, nothing left to create', () => {
    const input = rows.map((n, i) => ({ rowNumber: i + 1, normalized: n }));
    const keys = [...computeDedupeKeys('vendor-1', input).values()];
    const out = plan(rows, { H1: { fin: 250, bottles: 2 } }, { existingKeys: keys });
    expect(out.map((p) => p.action)).toEqual(['SKIP_EXISTING', 'SKIP_EXISTING']);
    expect(out[0].issues.map((i) => i.code)).toContain('ALREADY_IMPORTED');
  });

  it('a repeated voucher inside the file is skipped once, the first copy is kept', () => {
    const out = plan([rows[0], rows[0], rows[1]], { H1: { fin: 250, bottles: 2 } });
    expect(out.map((p) => p.action)).toEqual(['CREATE', 'SKIP_EXISTING', 'CREATE']);
    expect(out[1].issues.map((i) => i.code)).toContain('DUPLICATE_IN_FILE');
  });

  it('balance-only vouchers post nothing but still count for reconciliation', () => {
    const balanceOnly = v({ customerCode: 'H1', date: '2025-01-12', outstandingAfter: 250, bottleBalanceAfter: 2 });
    const out = plan([...rows, balanceOnly], { H1: { fin: 250, bottles: 2 } });
    expect(out.map((p) => p.action)).toEqual(['CREATE', 'CREATE', 'SKIP_EXISTING']);
    expect(out[2].issues.map((i) => i.code)).toContain('NO_MOVEMENT');
  });

  it('without running-balance columns it only warns, with the implied pre-history balance', () => {
    const bare = rows.map((r) => ({ ...r, outstandingAfter: null, bottleBalanceAfter: null }));
    const out = plan(bare, { H1: { fin: 300 } });
    expect(out.map((p) => p.action)).toEqual(['CREATE', 'CREATE']);
    const w = out[0].issues.find((i) => i.code === 'NO_RUNNING_BALANCE');
    expect(w?.severity).toBe('WARNING');
    expect(w?.data).toMatchObject({ implied: 50 }); // 300 now - (400 charged - 150 paid)
  });

  it('warns once on a broken running balance', () => {
    const broken = [rows[0], { ...rows[1], outstandingAfter: 100 }];
    const out = plan(broken, { H1: { fin: 100, bottles: 2 } });
    expect(out.map((p) => p.action)).toEqual(['CREATE', 'CREATE']);
    expect(out[1].issues.filter((i) => i.code === 'CHAIN_BREAK')).toHaveLength(1);
  });
});

describe('summarize', () => {
  it('counts posted rows, money and the unknown / blocked customers', () => {
    const rows = [
      v({ customerCode: 'H1', date: '2025-01-05', filled: 2, charge: 400, paid: 100, outstandingAfter: 300 }),
      v({ customerCode: 'NOPE', date: '2025-01-05', charge: 5 }),
      v({ customerCode: 'H2', date: '2025-01-05', charge: 10, outstandingAfter: 10 }),
    ];
    const planned = plan(rows, { H1: { fin: 300 }, H2: { fin: 99 } });
    const s = def.summarize(planned, OPTS);
    expect(s.create).toBe(1);
    expect(s.history).toMatchObject({ customersInFile: 3, customersToImport: 1, customersBlocked: 1, unknownCodes: 1, unknownCodeList: ['NOPE'], chargeRows: 1, paymentRows: 1, sumChargePaise: 40000, sumPaidPaise: 10000, bottlesOut: 2 });
    expect(s.history?.mismatches).toEqual([{ code: 'H2', expected: 99, file: 10, kind: 'MONEY' }]);
  });
});
