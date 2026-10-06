import * as ExcelJS from 'exceljs';
import { headerFingerprint, normalizeHeader, suggestMapping } from './column-mapper';
import { parseImportFile } from './file-parser';
import { computePlanHash } from './plan';
import { parseIsoDate, parseMoney, parseText, parseWholeNumber, toPaise } from './value-parsers';
import { customersOpeningDefinition } from '../definitions/customers-opening.definition';
import type { PlannedRow } from '../import.types';

describe('value-parsers', () => {
  it('parses money in the formats vendors really type', () => {
    expect(parseMoney('1,234.50')).toEqual({ ok: true, value: 1234.5, rounded: false });
    expect(parseMoney('Rs. 2,000')).toMatchObject({ ok: true, value: 2000 });
    expect(parseMoney('(500)')).toMatchObject({ ok: true, value: -500 });
    expect(parseMoney('-250')).toMatchObject({ ok: true, value: -250 });
    expect(parseMoney('1500/-')).toMatchObject({ ok: true, value: 1500 });
    expect(parseMoney(75)).toMatchObject({ ok: true, value: 75 });
  });
  it('treats blanks and dashes as empty, garbage as an error (never guesses)', () => {
    expect(parseMoney('')).toEqual({ ok: true, value: null });
    expect(parseMoney('-')).toEqual({ ok: true, value: null });
    expect(parseMoney(null)).toEqual({ ok: true, value: null });
    expect(parseMoney('abc')).toEqual({ ok: false });
    expect(parseMoney('12 34')).toMatchObject({ ok: true, value: 1234 }); // spaces are thousands separators
    expect(parseMoney('1.2.3')).toEqual({ ok: false });
  });
  it('flags (and rounds) more than 2 decimals', () => {
    expect(parseMoney('10.126')).toMatchObject({ ok: true, value: 10.13, rounded: true });
  });
  it('whole numbers reject fractions instead of rounding', () => {
    expect(parseWholeNumber('3')).toMatchObject({ ok: true, value: 3 });
    expect(parseWholeNumber(2.5)).toEqual({ ok: false });
    expect(parseWholeNumber('-2')).toMatchObject({ ok: true, value: -2 });
  });
  it('parseText / toPaise / parseIsoDate', () => {
    expect(parseText('  Ahmed   Khan ')).toBe('Ahmed Khan');
    expect(parseText('-')).toBeNull();
    expect(toPaise(10.1) + toPaise(20.2)).toBe(3030); // no float drift
    expect(parseIsoDate('2026-02-30')).toBeNull();
    expect(parseIsoDate('2026-10-07')).toBe('2026-10-07');
  });
});

describe('column-mapper', () => {
  const fields = customersOpeningDefinition.fields;
  const sug = (headers: string[], rows: Record<string, string | number | null>[] = []) =>
    Object.fromEntries(suggestMapping({ headers, sampleRows: rows, fields }).map((s) => [s.header, s.fieldKey]));

  it('detects the BLUE ICE-style headers', () => {
    const m = sug(['Cust_Code', 'Name', 'Contact', 'Area', 'Billing_Type', 'Rate', 'Bottle_Balance', 'Outstanding_Bal', 'Cust_Status']);
    expect(m).toMatchObject({
      Cust_Code: 'customerCode',
      Name: 'name',
      Contact: 'phone',
      Area: 'area',
      Billing_Type: 'paymentType',
      Rate: 'rate',
      Bottle_Balance: 'openingBottles',
      Outstanding_Bal: 'openingBalance',
      Cust_Status: 'isActive',
    });
  });
  it('does not map "Bottle Balance" onto the money balance', () => {
    const m = sug(['Customer Name', 'Balance', 'Bottle Balance']);
    expect(m['Balance']).toBe('openingBalance');
    expect(m['Bottle Balance']).toBe('openingBottles');
  });
  it('never maps one field twice and leaves unknown columns unmapped', () => {
    const m = sug(['Name', 'Customer Name', 'Favourite Colour']);
    const mapped = Object.values(m).filter(Boolean);
    expect(new Set(mapped).size).toBe(mapped.length);
    expect(m['Favourite Colour']).toBeNull();
  });
  it('uses a value-pattern hint for an unlabelled phone column', () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ Name: `C${i}`, 'Col B': `0300123456${i}` }));
    expect(sug(['Name', 'Col B'], rows)['Col B']).toBe('phone');
  });
  it('a saved profile wins over auto-detection', () => {
    const out = suggestMapping({ headers: ['Name', 'Zone'], sampleRows: [], fields, profileColumns: { Name: 'name', Zone: 'nearbyLandmark' } });
    expect(out.find((s) => s.header === 'Zone')).toMatchObject({ fieldKey: 'nearbyLandmark', confidence: 'profile' });
  });
  it('fingerprint ignores order and punctuation', () => {
    expect(headerFingerprint(['Cust_Code', 'Name'])).toBe(headerFingerprint(['name', 'cust code']));
    expect(normalizeHeader('Cust. Code')).toBe('cust code');
  });
});

describe('file-parser', () => {
  async function xlsx(rows: unknown[][]): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    rows.forEach((r) => ws.addRow(r));
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  it('reads headers + rows, skips blank rows, keeps spreadsheet row numbers', async () => {
    const buf = await xlsx([['Name', 'Phone'], ['Ali', '0300'], [null, null], ['Sara', '0311']]);
    const p = await parseImportFile(buf, '.xlsx');
    expect(p.headers).toEqual(['Name', 'Phone']);
    expect(p.rows.map((r) => r.rowNumber)).toEqual([2, 4]);
    expect(p.rows[1].values).toEqual({ Name: 'Sara', Phone: '0311' });
  });
  it('auto-detects a header that is not on row 1', async () => {
    const buf = await xlsx([['Customer list - Oct'], [], ['Name', 'Phone'], ['Ali', '0300']]);
    const p = await parseImportFile(buf, '.xlsx');
    expect(p.headerRowIndex).toBe(3);
    expect(p.rows).toHaveLength(1);
  });
  it('de-duplicates repeated headers', async () => {
    const buf = await xlsx([['Phone', 'Phone'], ['1', '2']]);
    expect((await parseImportFile(buf, '.xlsx')).headers).toEqual(['Phone', 'Phone (2)']);
  });
  it('reads formulas as their cached result, dates as ISO', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('S');
    ws.addRow(['Name', 'Amt', 'Since']);
    ws.addRow(['Ali', { formula: 'A1', result: 42 }, new Date(Date.UTC(2026, 0, 5))]);
    const p = await parseImportFile(Buffer.from(await wb.xlsx.writeBuffer()), '.xlsx');
    expect(p.rows[0].values).toEqual({ Name: 'Ali', Amt: 42, Since: '2026-01-05' });
  });
  it('parses CSV (BOM + semicolons)', async () => {
    const csv = Buffer.from('﻿Name;Phone\nAli;0300\n', 'utf8');
    const p = await parseImportFile(csv, '.csv');
    expect(p.headers).toEqual(['Name', 'Phone']);
    expect(p.rows[0].values).toEqual({ Name: 'Ali', Phone: '0300' });
  });
  it('rejects a corrupt file and an empty body with stable codes', async () => {
    await expect(parseImportFile(Buffer.from('not a zip'), '.xlsx')).rejects.toMatchObject({ code: 'CORRUPT_FILE' });
    await expect(parseImportFile(await xlsx([['Name', 'Phone']]), '.xlsx')).rejects.toMatchObject({ code: 'NO_DATA_ROWS' });
  });
});

describe('customers-opening: normalize → validate → plan', () => {
  const def = customersOpeningDefinition;
  const mapping = {
    columns: { Code: 'customerCode', Name: 'name', Phone: 'phone', Address: 'address', Type: 'paymentType', Status: 'isActive', Rate: 'rate', Bal: 'openingBalance', Bottles: 'openingBottles' },
    valueMaps: { isActive: { '0': 'true', '1': 'false' } },
  };
  const mapped = new Set(Object.values(mapping.columns));
  const options = def.parseOptions(
    { balanceSign: 'POSITIVE_MEANS_CUSTOMER_OWES', balancesAsOf: '2026-10-01', productId: 'p1', codeStrategy: 'USE_FILE_CODES' },
    { mappedFieldKeys: mapped, activeProducts: [{ id: 'p1', name: 'Bottle', basePrice: 240 }] },
  );
  const row = (v: Record<string, string | number | null>) => def.normalizeRow({ Code: 'C1', Name: 'Ali', Phone: '0300-1234567', Address: 'H1', Type: 'Cash', Status: 0, Rate: 240, Bal: '1,500', Bottles: 3, ...v }, mapping, options);
  const emptyCtx = { existingCodes: new Set<string>(), existingPhoneName: new Set<string>(), existingPhones: new Set<string>() };
  const plan = (rows: ReturnType<typeof row>[], ctx = emptyCtx) =>
    def.validateAndPlan(rows.map((r, i) => ({ rowNumber: i + 2, ...r })), ctx, options);

  it('normalizes a good row (sign, phone, enum maps)', () => {
    const r = row({});
    expect(r.issues).toEqual([]);
    expect(r.normalized).toMatchObject({ customerCode: 'C1', phoneNumber: '923001234567', paymentType: 'CASH', isActive: true, rate: 240, openingBalance: 1500, openingBottles: 3 });
  });
  it('flips the sign when positive means WE owe the customer', () => {
    const o = def.parseOptions({ balanceSign: 'POSITIVE_MEANS_WE_OWE_CUSTOMER', balancesAsOf: '2026-10-01', productId: 'p1' }, { mappedFieldKeys: mapped, activeProducts: [{ id: 'p1', name: 'B', basePrice: 240 }] });
    expect(def.normalizeRow({ Code: 'C1', Name: 'A', Address: 'x', Bal: 500 }, mapping, o).normalized?.openingBalance).toBe(-500);
  });
  it('fails closed: unmapped enum value and bad money are ERRORs', () => {
    expect(row({ Status: 'weird' }).issues.map((i) => i.code)).toContain('UNMAPPED_VALUE');
    expect(row({ Bal: 'lots' }).issues.map((i) => i.code)).toContain('INVALID_NUMBER');
    expect(row({ Name: null }).issues.map((i) => i.code)).toContain('NAME_REQUIRED');
    expect(row({ Bottles: 1.5 }).normalized).toBeNull();
  });
  it('blank phone is a warning, not an error, and stores "-"', () => {
    const r = row({ Phone: null });
    expect(r.normalized?.phoneNumber).toBe('-');
    expect(r.issues.map((i) => [i.severity, i.code])).toContainEqual(['WARNING', 'PHONE_MISSING']);
  });
  it('skips existing codes, blocks in-file duplicates, plans the rest', () => {
    const planned = plan(
      [row({ Code: 'A1' }), row({ Code: 'A1', Name: 'Dup' }), row({ Code: 'EXIST' }), row({ Code: 'N1', Phone: '0311-0000001' })],
      { ...emptyCtx, existingCodes: new Set(['EXIST']) },
    );
    expect(planned.map((p) => p.action)).toEqual(['CREATE', 'SKIP_INVALID', 'SKIP_EXISTING', 'CREATE']);
    expect(planned[1].issues.map((i) => i.code)).toContain('DUPLICATE_CODE_IN_FILE');
  });
  it('code-less rows are matched to existing customers by phone + name', () => {
    const noCode = def.parseOptions({ balanceSign: 'POSITIVE_MEANS_CUSTOMER_OWES', balancesAsOf: '2026-10-01', productId: 'p1', codeStrategy: 'GENERATE' }, { mappedFieldKeys: mapped, activeProducts: [{ id: 'p1', name: 'B', basePrice: 240 }] });
    const n = def.normalizeRow({ Code: 'IGNORED', Name: 'Ali', Phone: '0300-1234567', Address: 'H1' }, mapping, noCode);
    expect(n.normalized?.customerCode).toBeNull();
    const p = def.validateAndPlan([{ rowNumber: 2, ...n }], { ...emptyCtx, existingPhoneName: new Set(['923001234567|ali']) }, noCode);
    expect(p[0].action).toBe('SKIP_EXISTING');
  });
  it('summary totals use integer paise and count only CREATE rows', () => {
    const planned = plan([row({ Code: 'A', Bal: '10.10' }), row({ Code: 'B', Bal: '20.20' }), row({ Code: 'C', Bal: 'x' })]);
    const s = def.summarize(planned);
    expect(s).toMatchObject({ total: 3, create: 2, skipInvalid: 1, sumOpeningBalancePaise: 3030, sumOpeningBottles: 6 });
  });
  it('requires explicit sign + as-of date when balances are mapped; product when bottles/rate are', () => {
    const info = { mappedFieldKeys: mapped, activeProducts: [{ id: 'p1', name: 'B', basePrice: 240 }, { id: 'p2', name: 'C', basePrice: 100 }] };
    expect(() => def.parseOptions({ balancesAsOf: '2026-10-01', productId: 'p1' }, info)).toThrow(/positive balance/i);
    expect(() => def.parseOptions({ balanceSign: 'POSITIVE_MEANS_CUSTOMER_OWES', productId: 'p1' }, info)).toThrow(/date/i);
    expect(() => def.parseOptions({ balanceSign: 'POSITIVE_MEANS_CUSTOMER_OWES', balancesAsOf: '2026-10-01' }, info)).toThrow(/product/i);
    expect(() => def.parseOptions({ balanceSign: 'POSITIVE_MEANS_CUSTOMER_OWES', balancesAsOf: '2026-10-01' }, { ...info, activeProducts: [] })).toThrow(/product/i);
  });

  describe('plan hash', () => {
    const planned = (): PlannedRow<unknown>[] => plan([row({ Code: 'A' }), row({ Code: 'B' })]);
    it('is deterministic and changes with rows, mapping or options', () => {
      const h = computePlanHash(planned(), mapping, options);
      expect(computePlanHash(planned(), mapping, options)).toBe(h);
      expect(computePlanHash(planned().slice(0, 1), mapping, options)).not.toBe(h);
      expect(computePlanHash(planned(), { ...mapping, valueMaps: {} }, options)).not.toBe(h);
      expect(computePlanHash(planned(), mapping, { ...options, productId: 'p2' })).not.toBe(h);
    });
  });
});
