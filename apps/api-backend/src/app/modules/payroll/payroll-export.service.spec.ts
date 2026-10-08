import { NotFoundException } from '@nestjs/common';
import { buildPayrollCsv, PAYROLL_CSV_HEADERS, PayrollExportService, type PayrollCsvRow } from './payroll-export.service';

const BOM = '﻿';

const row = (over: Partial<PayrollCsvRow> = {}): PayrollCsvRow => ({
  user: { name: 'Ali Raza', role: 'LOADER' },
  baseSalary: 30000,
  bonuses: 1000,
  overtime: 500,
  incentives: 250,
  advances: -5000,
  expenses: 300,
  penalties: -100,
  otherDeductions: -200,
  carryForwardIn: 400,
  deferredIn: 50,
  deferredOut: 75,
  finalPayable: 27000,
  status: 'LOCKED',
  settledAmount: 10000,
  pendingAbsenceDays: 2,
  ...over,
});

const parse = (csv: string) => csv.replace(BOM, '').split('\r\n').filter(Boolean);

describe('buildPayrollCsv', () => {
  it('starts with the BOM, ends with CRLF, and has the 19 agreed columns in order', () => {
    const csv = buildPayrollCsv('2026-09', [row()]);
    expect(csv.startsWith(BOM)).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(parse(csv)[0]).toBe(PAYROLL_CSV_HEADERS.join(','));
    expect(PAYROLL_CSV_HEADERS).toHaveLength(19);
  });

  it('writes one row per employee with every amount and balance = finalPayable - settled', () => {
    const [, line] = parse(buildPayrollCsv('2026-09', [row()]));
    expect(line).toBe(
      '2026-09,Ali Raza,LOADER,30000.00,1000.00,500.00,250.00,-5000.00,300.00,-100.00,-200.00,400.00,50.00,75.00,27000.00,LOCKED,10000.00,17000.00,2',
    );
  });

  it('keeps a negative balance (over-settled) a NUMBER, never prefixed as text', () => {
    const [, line] = parse(buildPayrollCsv('2026-09', [row({ finalPayable: 1000, settledAmount: 1500 })]));
    expect(line.split(',')[17]).toBe('-500.00');
  });

  it('defaults settled / pending absence to 0 when the row carries none', () => {
    const [, line] = parse(buildPayrollCsv('2026-09', [row({ settledAmount: undefined, pendingAbsenceDays: undefined })]));
    const cells = line.split(',');
    expect(cells[16]).toBe('0.00');
    expect(cells[17]).toBe('27000.00');
    expect(cells[18]).toBe('0');
  });

  it.each(['=HYPERLINK("http://evil")', '+1+1', '-2+3', '@SUM(A1)', '\tcmd', '\rcmd'])('neutralises formula-leading name %p', (name) => {
    const csv = buildPayrollCsv('2026-09', [row({ user: { name, role: 'LOADER' } })]);
    const body = csv.replace(BOM, '');
    // the name cell (2nd column) must start with the neutralising apostrophe, quoted or not
    expect(body).toMatch(/,"?'[=+\-@\t\r]/);
    // ... and a raw formula character must never lead any cell (a bare "-" is a legit negative number)
    expect(body).not.toMatch(/(^|,|\r\n)"?[=+@\t]/);
  });

  it('quotes a name containing a comma or quote (RFC 4180)', () => {
    const [, line] = parse(buildPayrollCsv('2026-09', [row({ user: { name: 'Raza, Ali "Boss"', role: 'LOADER' } })]));
    expect(line.startsWith('2026-09,"Raza, Ali ""Boss""",LOADER')).toBe(true);
  });

  it('an empty period still yields a header-only file', () => {
    expect(parse(buildPayrollCsv('2026-09', []))).toEqual([PAYROLL_CSV_HEADERS.join(',')]);
  });
});

describe('PayrollExportService', () => {
  const user = { userId: 'u1', vendorId: 'vendor-A' } as any;

  function make(period: any, rows: any[] = [row()]) {
    const prisma = { payrollPeriod: { findFirst: jest.fn().mockResolvedValue(period) } };
    const entries = { listForPeriod: jest.fn().mockResolvedValue(rows) };
    return { svc: new PayrollExportService(prisma as any, entries as any), prisma, entries };
  }

  it('looks the period up scoped to the vendor and reads rows through listForPeriod', async () => {
    const { svc, prisma, entries } = make({ periodLabel: '2026-09' });
    const out = await svc.exportPeriodCsv(user, 'period-1');
    expect(prisma.payrollPeriod.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'period-1', vendorId: 'vendor-A' } }));
    expect(entries.listForPeriod).toHaveBeenCalledWith(user, 'period-1');
    expect(out.filename).toBe('payroll-2026-09.csv');
    expect(out.truncated).toBe(false);
    expect(out.body).toContain('Ali Raza');
  });

  it('404s (and never lists rows) for a period of another vendor', async () => {
    const { svc, entries } = make(null);
    await expect(svc.exportPeriodCsv(user, 'foreign')).rejects.toBeInstanceOf(NotFoundException);
    expect(entries.listForPeriod).not.toHaveBeenCalled();
  });

  it('works for a LOCKED / PAID (historical) period — no status filtering', async () => {
    const { svc } = make({ periodLabel: '2025-12', status: 'PAID' });
    await expect(svc.exportPeriodCsv(user, 'p')).resolves.toMatchObject({ filename: 'payroll-2025-12.csv' });
  });
});
