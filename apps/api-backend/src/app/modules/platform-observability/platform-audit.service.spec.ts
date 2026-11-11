import { BadRequestException } from '@nestjs/common';
import { PlatformAuditService, CSV_HEADER, EXPORT_ROW_CAP } from './platform-audit.service';
import { redactSensitive, redactText } from './redact.util';
import { csvCell, csvRow } from './csv.util';

const V1 = '11111111-1111-4111-8111-111111111111';
const V2 = '22222222-2222-4222-8222-222222222222';

describe('PlatformAuditService', () => {
  let prisma: any;
  let service: PlatformAuditService;

  const row = (over: Record<string, unknown> = {}) => ({
    id: 'a1', createdAt: new Date('2026-01-02T03:04:05Z'), vendorId: V1, userId: null, userName: 'Ann', action: 'UPDATE', entity: 'Customer', entityId: 'c1',
    changes: { before: { name: 'a' }, after: { name: 'b', password: 'x' } }, ...over,
  });

  beforeEach(() => {
    prisma = {
      auditLog: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), groupBy: jest.fn(), findUnique: jest.fn() },
      vendor: { findMany: jest.fn().mockResolvedValue([{ id: V1, name: 'Vendor One' }]) },
    };
    service = new PlatformAuditService(prisma);
  });

  it('builds where from all filters; q is case-insensitive contains on userName', async () => {
    await service.findAll({ vendorId: V1, userId: V2, action: 'UPDATE', entity: 'Customer', entityId: 'c1', q: 'an', page: 2, limit: 10 });
    const args = prisma.auditLog.findMany.mock.calls[0][0];
    expect(args.where).toMatchObject({ vendorId: V1, userId: V2, action: 'UPDATE', entity: 'Customer', entityId: 'c1', userName: { contains: 'an', mode: 'insensitive' } });
    expect(args.skip).toBe(10);
    expect(args.take).toBe(10);
  });

  it('date-only "to" includes the whole day; full ISO is used as is', () => {
    const a = service.buildWhere({ from: '2026-01-01', to: '2026-01-31' }).where;
    expect(a.createdAt.gte.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(a.createdAt.lte.toISOString()).toBe('2026-01-31T23:59:59.999Z');
    const b = service.buildWhere({ to: '2026-01-31T10:00:00.000Z' }).where;
    expect(b.createdAt.lte.toISOString()).toBe('2026-01-31T10:00:00.000Z');
  });

  it('rejects from > to with 400', () => {
    expect(() => service.buildWhere({ from: '2026-02-01', to: '2026-01-01' })).toThrow(BadRequestException);
  });

  it('joins vendor names with ONE batch lookup; null vendor -> null name; redacts changes', async () => {
    prisma.auditLog.findMany.mockResolvedValue([row(), row({ id: 'a2', vendorId: null }), row({ id: 'a3' })]);
    prisma.auditLog.count.mockResolvedValue(3);
    const res = await service.findAll({});
    expect(prisma.vendor.findMany).toHaveBeenCalledTimes(1);
    expect(res.data.map((r) => r.vendorName)).toEqual(['Vendor One', null, 'Vendor One']);
    expect((res.data[0].changes as any).after.password).toBe('[REDACTED]');
    expect(res.meta).toMatchObject({ total: 3, page: 1, limit: 20 });
  });

  it('facets use groupBy and are cached', async () => {
    prisma.auditLog.groupBy.mockResolvedValueOnce([{ action: 'CREATE' }]).mockResolvedValueOnce([{ entity: 'Customer' }]);
    const a = await service.facets();
    const b = await service.facets();
    expect(a).toEqual({ actions: ['CREATE'], entities: ['Customer'] });
    expect(b).toBe(a);
    expect(prisma.auditLog.groupBy).toHaveBeenCalledTimes(2);
  });

  it('export: defaults to a 30-day window, caps range at 366 days, flags truncation', async () => {
    prisma.auditLog.count.mockResolvedValue(EXPORT_ROW_CAP + 1);
    const r = await service.prepareExport({});
    expect(r.where.createdAt.gte).toBeInstanceOf(Date);
    expect(r.truncated).toBe(true);
    await expect(service.prepareExport({ from: '2020-01-01', to: '2026-01-01' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('export chunks: BOM + header, neutralises formulas, stringifies changes, stops at cap', async () => {
    prisma.auditLog.findMany.mockResolvedValueOnce([row({ userName: '=cmd|calc', id: 'x1' })]);
    const counter = { rows: 0 };
    let out = '';
    for await (const c of service.exportChunks({}, counter)) out += c;
    expect(out.startsWith('﻿' + CSV_HEADER.join(',') + '\r\n')).toBe(true);
    expect(out).toContain("'=cmd|calc");
    expect(out).toContain('[REDACTED]');
    expect(counter.rows).toBe(1);
    // cap: pretend we already hit it
    prisma.auditLog.findMany.mockClear();
    for await (const c of service.exportChunks({}, { rows: EXPORT_ROW_CAP })) void c;
    expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
  });
});

describe('redactSensitive / redactText / csv', () => {
  it('masks sensitive keys at any depth, leaves others, handles null/arrays', () => {
    const out: any = redactSensitive({ a: 1, password: 'p', n: { Authorization: 'Bearer x', tokenCipher: 'c', ok: [{ secret: 's', fine: 2 }] } });
    expect(out).toEqual({ a: 1, password: '[REDACTED]', n: { Authorization: '[REDACTED]', tokenCipher: '[REDACTED]', ok: [{ secret: '[REDACTED]', fine: 2 }] } });
    expect(redactSensitive(null)).toBeNull();
    expect(redactSensitive('x')).toBe('x');
  });

  it('caps depth', () => {
    let o: any = { v: 1 };
    for (let i = 0; i < 30; i++) o = { n: o };
    expect(JSON.stringify(redactSensitive(o))).toContain('[TRUNCATED]');
  });

  it('redactText strips bearer tokens, token params, url credentials and truncates', () => {
    const t = redactText('fail Bearer abc.def https://u:pw@host/x?access_token=zzz', 300)!;
    expect(t).not.toMatch(/abc\.def|u:pw|zzz/);
    expect(redactText('x'.repeat(500))!.length).toBe(300);
    expect(redactText(null)).toBeNull();
  });

  it('csv cells: formula guard, quote escaping, newlines', () => {
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-1')).toBe("'-1");
    expect(csvCell('@x')).toBe("'@x");
    expect(csvCell('a"b')).toBe('"a""b"');
    expect(csvCell('a\nb')).toBe('"a\nb"');
    expect(csvCell(null)).toBe('');
    expect(csvRow(['a', 'b,c'])).toBe('a,"b,c"\r\n');
  });
});
