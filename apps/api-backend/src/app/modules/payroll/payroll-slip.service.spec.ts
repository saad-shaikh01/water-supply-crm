import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { JOB_NAMES } from '@water-supply-crm/queue';
import { CloudTemplateNames } from '../whatsapp/templates/cloud-template-names';
import {
  PayrollSlipService,
  SLIP_SEND_DELAY_MAX_MS,
  SLIP_SEND_DELAY_MIN_MS,
} from './payroll-slip.service';

const user = { userId: 'admin-1', vendorId: 'vendor-A' } as any;

const period = { id: 'period-1', periodLabel: '2026-09', startDate: new Date('2026-09-01T00:00:00Z'), endDate: new Date('2026-09-30T23:59:59.999Z') };

const entryRow = (id: string, over: any = {}) => ({
  id,
  userId: `user-${id}`,
  status: 'APPROVED',
  finalPayable: 25000,
  version: 3,
  baseSalary: 25000,
  bonuses: 0, overtime: 0, incentives: 0, advances: 0, expenses: 0, penalties: 0, otherDeductions: 0,
  carryForwardIn: 0, deferredIn: 0, deferredOut: 0,
  user: { id: `user-${id}`, name: `Emp ${id}`, role: 'LOADER', phoneNumber: '0300-1234567' },
  ...over,
});

const attendance = { decisionsApply: true, periodDayCount: 30, presentDays: 30, absentDays: 0, halfDays: 0, leaveDays: 0, days: [] };

function make() {
  const prisma: any = {
    payrollPeriod: { findFirst: jest.fn().mockResolvedValue(period) },
    payrollEntry: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn() },
    payrollSlipDelivery: {
      findMany: jest.fn().mockResolvedValue([]),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockImplementation(async ({ where }: any) => ({ count: typeof where?.id === 'string' ? 1 : 0 })),
      count: jest.fn().mockResolvedValue(0),
    },
    payrollSlipDispatch: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'dispatch-1', createdAt: new Date(), ...data })),
      update: jest.fn().mockResolvedValue({}),
    },
    user: { findMany: jest.fn().mockResolvedValue([]) },
    vendor: { findUnique: jest.fn().mockResolvedValue({ name: 'Blue Ice' }) },
    $executeRaw: jest.fn().mockResolvedValue(1),
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
  };
  const payrollEntries = { attendanceSummaryFor: jest.fn().mockResolvedValue({ structure: null, attendance }) };
  const pdf = { generate: jest.fn().mockResolvedValue(Buffer.from('%PDF-fake')) };
  const whatsapp = { isReadyFor: jest.fn().mockResolvedValue(true), sendTemplate: jest.fn().mockResolvedValue(true) };
  const queue = { add: jest.fn().mockResolvedValue({}) };
  const branding = { resolveForDocs: jest.fn().mockResolvedValue({ name: 'Blue Ice' }) };
  const service = new PayrollSlipService(prisma, payrollEntries as any, pdf as any, whatsapp as any, queue as any, branding as any);
  // never really sleep in specs
  const delaySpy = jest.spyOn(service as any, 'sendDelay').mockResolvedValue(undefined);
  return { service, prisma, payrollEntries, pdf, whatsapp, queue, delaySpy };
}

/** Seeds classify(): the period's entries + any previously-SENT deliveries. */
function seedEntries(m: ReturnType<typeof make>, entries: any[], sentBefore: any[] = []) {
  m.prisma.payrollEntry.findMany.mockImplementation(async (args: any) => {
    // classify() reads full entries; send()'s transaction reads {id,version,finalPayable} for the snapshot
    return entries.filter((e) => !args?.where?.id?.in || args.where.id.in.includes(e.id));
  });
  m.prisma.payrollSlipDelivery.findMany.mockResolvedValue(sentBefore);
}

describe('PayrollSlipService.preview', () => {
  it('scopes the period AND the entries to the vendor + period', async () => {
    const m = make();
    seedEntries(m, [entryRow('e1')]);
    await m.service.preview(user, 'period-1', {});
    expect(m.prisma.payrollPeriod.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'period-1', vendorId: 'vendor-A' } }));
    expect(m.prisma.payrollEntry.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { periodId: 'period-1', vendorId: 'vendor-A' } }));
  });

  it('404s for another vendor’s period', async () => {
    const m = make();
    m.prisma.payrollPeriod.findFirst.mockResolvedValue(null);
    await expect(m.service.preview(user, 'foreign', {})).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404s when a requested entry is not in this vendor/period (no partial send of foreign ids)', async () => {
    const m = make();
    seedEntries(m, [entryRow('e1')]);
    await expect(m.service.preview(user, 'period-1', { entryIds: ['e1', 'foreign-entry'] })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('classifies DRAFT / UNDER_REVIEW as NOT_FINAL with a reason, missing phone as NO_PHONE, flags already-sent', async () => {
    const m = make();
    seedEntries(
      m,
      [
        entryRow('draft', { status: 'DRAFT' }),
        entryRow('review', { status: 'UNDER_REVIEW' }),
        entryRow('nophone', { user: { id: 'u', name: 'No Phone', role: 'LOADER', phoneNumber: '-' } }),
        entryRow('ok'),
        entryRow('sent', { finalPayable: 26000 }),
      ],
      [{ payrollEntryId: 'sent', sentAt: new Date('2026-10-01T10:00:00Z'), finalPayable: 25000 }],
    );
    const out = await m.service.preview(user, 'period-1', {});
    const by = Object.fromEntries(out.items.map((i) => [i.entryId, i]));
    expect(by.draft).toMatchObject({ verdict: 'NOT_FINAL', reason: expect.stringContaining('approve') });
    expect(by.review.verdict).toBe('NOT_FINAL');
    expect(by.nophone).toMatchObject({ verdict: 'NO_PHONE', reason: expect.stringContaining('WhatsApp') });
    expect(by.ok).toMatchObject({ verdict: 'ELIGIBLE', reason: null, alreadySent: null });
    expect(by.sent.alreadySent).toMatchObject({ finalPayable: 25000, amountChanged: true });
    expect(out.counts).toEqual({ total: 5, eligible: 2, notFinal: 2, noPhone: 1, alreadySent: 1 });
  });

  it('never leaks a raw phone number in the preview', async () => {
    const m = make();
    seedEntries(m, [entryRow('ok')]);
    const out = await m.service.preview(user, 'period-1', {});
    expect(JSON.stringify(out)).not.toContain('1234567');
  });
});

describe('PayrollSlipService.send', () => {
  it('queues ONE job for the batch (no loop in the request) with attempts:1 and a deterministic jobId', async () => {
    const m = make();
    seedEntries(m, [entryRow('e1'), entryRow('e2')]);
    const out = await m.service.send(user, 'period-1', {});
    expect(m.queue.add).toHaveBeenCalledTimes(1);
    expect(m.queue.add).toHaveBeenCalledWith(
      JOB_NAMES.SEND_PAYROLL_SLIPS,
      { dispatchId: 'dispatch-1', vendorId: 'vendor-A' },
      expect.objectContaining({ attempts: 1, jobId: 'payroll-slip-dispatch-1' }),
    );
    expect(out).toMatchObject({ dispatchId: 'dispatch-1', queued: 2 });
    // nothing is sent inside the request
    expect(m.whatsapp.sendTemplate).not.toHaveBeenCalled();
  });

  it('stores QUEUED rows with the NORMALIZED phone + the entry snapshot', async () => {
    const m = make();
    seedEntries(m, [entryRow('e1')]);
    await m.service.send(user, 'period-1', {});
    const { data } = m.prisma.payrollSlipDelivery.createMany.mock.calls[0][0];
    expect(data).toEqual([
      expect.objectContaining({ payrollEntryId: 'e1', vendorId: 'vendor-A', periodId: 'period-1', status: 'QUEUED', phone: '923001234567', finalPayable: 25000, entryVersion: 3 }),
    ]);
  });

  it('records no-phone employees as SKIPPED_NO_PHONE rows and reports them', async () => {
    const m = make();
    seedEntries(m, [entryRow('ok'), entryRow('np', { user: { id: 'u', name: 'No Phone', role: 'LOADER', phoneNumber: null } })]);
    const out = await m.service.send(user, 'period-1', {});
    const { data } = m.prisma.payrollSlipDelivery.createMany.mock.calls[0][0];
    expect(data.find((d: any) => d.payrollEntryId === 'np')).toMatchObject({ status: 'SKIPPED_NO_PHONE', phone: null });
    expect(out.skippedNoPhone).toEqual([{ entryId: 'np', name: 'No Phone' }]);
    expect(m.prisma.payrollSlipDispatch.create.mock.calls[0][0].data).toMatchObject({ total: 2, skipped: 1 });
  });

  it('only no-phone entries → dispatch is COMPLETED immediately and NO job is queued', async () => {
    const m = make();
    seedEntries(m, [entryRow('np', { user: { id: 'u', name: 'No Phone', role: 'LOADER', phoneNumber: '-' } })]);
    const out = await m.service.send(user, 'period-1', {});
    expect(out.status).toBe('COMPLETED');
    expect(m.queue.add).not.toHaveBeenCalled();
  });

  it('reports DRAFT entries as skipped (never queued) and refuses when nothing is sendable', async () => {
    const m = make();
    seedEntries(m, [entryRow('d', { status: 'DRAFT' })]);
    await expect(m.service.send(user, 'period-1', {})).rejects.toBeInstanceOf(BadRequestException);
    expect(m.prisma.payrollSlipDispatch.create).not.toHaveBeenCalled();
    expect(m.queue.add).not.toHaveBeenCalled();
  });

  it('mixed batch: sends the final ones, lists the DRAFT one under skippedNotFinal', async () => {
    const m = make();
    seedEntries(m, [entryRow('ok'), entryRow('d', { status: 'DRAFT' })]);
    const out = await m.service.send(user, 'period-1', {});
    expect(out.queued).toBe(1);
    expect(out.skippedNotFinal).toEqual([{ entryId: 'd', name: 'Emp d', status: 'DRAFT' }]);
  });

  describe('already-sent protection', () => {
    const sent = [{ payrollEntryId: 'e1', sentAt: new Date('2026-10-01T10:00:00Z'), finalPayable: 25000 }];

    it('409 SLIP_ALREADY_SENT without confirmResend — and nothing is created or queued', async () => {
      const m = make();
      seedEntries(m, [entryRow('e1'), entryRow('e2')], sent);
      const err: any = await m.service.send(user, 'period-1', {}).catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.getResponse()).toMatchObject({ code: 'SLIP_ALREADY_SENT', alreadySent: [expect.objectContaining({ entryId: 'e1' })] });
      expect(m.prisma.payrollSlipDispatch.create).not.toHaveBeenCalled();
      expect(m.queue.add).not.toHaveBeenCalled();
    });

    it('confirmResend sends them again', async () => {
      const m = make();
      seedEntries(m, [entryRow('e1'), entryRow('e2')], sent);
      const out = await m.service.send(user, 'period-1', { confirmResend: true });
      expect(out.queued).toBe(2);
    });

    it('skipAlreadySent leaves them out and reports it', async () => {
      const m = make();
      seedEntries(m, [entryRow('e1'), entryRow('e2')], sent);
      const out = await m.service.send(user, 'period-1', { skipAlreadySent: true });
      expect(out.queued).toBe(1);
      expect(out.skippedAlreadySent).toEqual([{ entryId: 'e1', name: 'Emp e1' }]);
      const { data } = m.prisma.payrollSlipDelivery.createMany.mock.calls[0][0];
      expect(data.map((d: any) => d.payrollEntryId)).toEqual(['e2']);
    });

    it('only previously-SENT deliveries count (a FAILED/skipped earlier attempt does not block)', async () => {
      const m = make();
      seedEntries(m, [entryRow('e1')], []); // lastSent query filters status SENT; nothing returned
      await expect(m.service.send(user, 'period-1', {})).resolves.toMatchObject({ queued: 1 });
      const q = m.prisma.payrollSlipDelivery.findMany.mock.calls[0][0];
      expect(q.where).toMatchObject({ vendorId: 'vendor-A', status: 'SENT' });
    });
  });

  it('refuses a second send while one is active for the vendor (409) — creates nothing', async () => {
    const m = make();
    seedEntries(m, [entryRow('e1')]);
    m.prisma.payrollSlipDispatch.findFirst.mockResolvedValue({ id: 'running-1' });
    const err: any = await m.service.send(user, 'period-1', {}).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toMatchObject({ code: 'SLIP_DISPATCH_ACTIVE', dispatchId: 'running-1' });
    expect(m.prisma.payrollSlipDispatch.findFirst.mock.calls[0][0].where).toMatchObject({ vendorId: 'vendor-A', OR: expect.any(Array) });
    expect(m.prisma.payrollSlipDispatch.create).not.toHaveBeenCalled();
  });

  it('rejects more than the per-dispatch cap', async () => {
    const m = make();
    seedEntries(m, Array.from({ length: 501 }, (_, i) => entryRow(`e${i}`)));
    await expect(m.service.send(user, 'period-1', {})).rejects.toBeInstanceOf(BadRequestException);
    expect(m.queue.add).not.toHaveBeenCalled();
  });

  it('a queue failure marks the dispatch FAILED, fails its QUEUED rows and rethrows', async () => {
    const m = make();
    seedEntries(m, [entryRow('e1')]);
    m.queue.add.mockRejectedValue(new Error('redis down'));
    await expect(m.service.send(user, 'period-1', {})).rejects.toThrow('redis down');
    expect(m.prisma.payrollSlipDelivery.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { dispatchId: 'dispatch-1', status: 'QUEUED' }, data: expect.objectContaining({ status: 'FAILED' }) }),
    );
    expect(m.prisma.payrollSlipDispatch.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }));
  });
});

describe('PayrollSlipService.runDispatch', () => {
  function seedRun(m: ReturnType<typeof make>, entries: any[], dispatchOver: any = {}) {
    m.prisma.payrollSlipDispatch.findUnique.mockResolvedValue({ id: 'dispatch-1', status: 'QUEUED', sent: 0, skipped: 0, failed: 0, startedAt: null, ...dispatchOver });
    m.prisma.payrollSlipDelivery.findMany.mockResolvedValue(
      entries.map((e, i) => ({ id: `del-${i}`, vendorId: 'vendor-A', payrollEntryId: e.id, createdAt: new Date(i) })),
    );
    m.prisma.payrollEntry.findFirst.mockImplementation(async ({ where }: any) => {
      const e = entries.find((x) => x.id === where.id);
      return e && where.vendorId === 'vendor-A' ? { ...e, period } : null;
    });
  }
  const lastDispatchUpdate = (m: ReturnType<typeof make>) => m.prisma.payrollSlipDispatch.update.mock.calls.at(-1)[0].data;
  const deliveryUpdates = (m: ReturnType<typeof make>) => m.prisma.payrollSlipDelivery.update.mock.calls.map((c: any) => c[0]);

  it('sends each slip through the approved template with the PDF attached — never free text', async () => {
    const m = make();
    seedRun(m, [entryRow('e1', { finalPayable: 45000 })]);
    await m.service.runDispatch('dispatch-1');
    expect(m.whatsapp.sendTemplate).toHaveBeenCalledTimes(1);
    expect(m.whatsapp.sendTemplate).toHaveBeenCalledWith(
      'vendor-A',
      '923001234567',
      CloudTemplateNames.SALARY_SLIP,
      ['Emp e1', '2026-09', '45,000'],
      { buffer: expect.any(Buffer), filename: 'Salary-Slip-2026-09-Emp-e1.pdf' },
    );
    expect(deliveryUpdates(m)[0]).toMatchObject({ where: { id: 'del-0' }, data: expect.objectContaining({ status: 'SENT', sentAt: expect.any(Date) }) });
    expect(lastDispatchUpdate(m)).toMatchObject({ status: 'COMPLETED', sent: 1, skipped: 0, failed: 0, finishedAt: expect.any(Date) });
  });

  it('builds the slip from ONLY that employee (vendor-scoped entry + own attendance)', async () => {
    const m = make();
    seedRun(m, [entryRow('e1')]);
    await m.service.runDispatch('dispatch-1');
    expect(m.prisma.payrollEntry.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'e1', vendorId: 'vendor-A' } }));
    expect(m.payrollEntries.attendanceSummaryFor).toHaveBeenCalledWith('vendor-A', 'user-e1', period);
    const slip = m.pdf.generate.mock.calls[0][0];
    expect(slip).toMatchObject({ employeeName: 'Emp e1', periodLabel: '2026-09', finalPayable: 25000, vendorName: 'Blue Ice' });
  });

  it('strips newlines/tabs/space runs from the employee name template parameter (Meta rejects them)', async () => {
    const m = make();
    seedRun(m, [entryRow('e1', { user: { id: 'u', name: 'Ali\n  Raza\t', role: 'LOADER', phoneNumber: '03001234567' } })]);
    await m.service.runDispatch('dispatch-1');
    expect(m.whatsapp.sendTemplate.mock.calls[0][3][0]).toBe('Ali Raza');
  });

  it('pauses (randomized sendDelay) between sends — n-1 times, never after the last', async () => {
    const m = make();
    seedRun(m, [entryRow('a'), entryRow('b'), entryRow('c')]);
    await m.service.runDispatch('dispatch-1');
    expect(m.whatsapp.sendTemplate).toHaveBeenCalledTimes(3);
    expect(m.delaySpy).toHaveBeenCalledTimes(2);
  });

  it('does not pause after a skipped (no-phone) employee — nothing was sent', async () => {
    const m = make();
    seedRun(m, [entryRow('a'), entryRow('np', { user: { id: 'u', name: 'NP', role: 'LOADER', phoneNumber: '-' } }), entryRow('c')]);
    await m.service.runDispatch('dispatch-1');
    expect(m.whatsapp.sendTemplate).toHaveBeenCalledTimes(2);
    expect(m.delaySpy).toHaveBeenCalledTimes(1); // a → c; the skipped one adds no pause
    expect(deliveryUpdates(m)[1].data).toMatchObject({ status: 'SKIPPED_NO_PHONE' });
    expect(lastDispatchUpdate(m)).toMatchObject({ sent: 2, skipped: 1, status: 'COMPLETED' });
  });

  it('aborts mid-batch when WhatsApp drops: the rest become SKIPPED_DISCONNECTED, dispatch ABORTED, no more sends', async () => {
    const m = make();
    seedRun(m, [entryRow('a'), entryRow('b'), entryRow('c')]);
    m.whatsapp.isReadyFor.mockResolvedValueOnce(true).mockResolvedValue(false);
    await m.service.runDispatch('dispatch-1');
    expect(m.whatsapp.sendTemplate).toHaveBeenCalledTimes(1);
    expect(m.prisma.payrollSlipDelivery.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['del-1', 'del-2'] }, status: 'QUEUED' }, data: expect.objectContaining({ status: 'SKIPPED_DISCONNECTED' }) }),
    );
    expect(lastDispatchUpdate(m)).toMatchObject({ status: 'ABORTED', sent: 1, skipped: 2 });
  });

  it('a falsy sendTemplate is a FAILED result (with a reason) and the batch continues', async () => {
    const m = make();
    seedRun(m, [entryRow('a'), entryRow('b')]);
    m.whatsapp.sendTemplate.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await m.service.runDispatch('dispatch-1');
    expect(deliveryUpdates(m)[0].data).toMatchObject({ status: 'FAILED', error: expect.stringContaining('Not delivered') });
    expect(deliveryUpdates(m)[1].data).toMatchObject({ status: 'SENT' });
    expect(lastDispatchUpdate(m)).toMatchObject({ sent: 1, failed: 1, status: 'COMPLETED' });
  });

  it('an exception while building/sending one slip fails ONLY that slip', async () => {
    const m = make();
    seedRun(m, [entryRow('a'), entryRow('b')]);
    m.pdf.generate.mockRejectedValueOnce(new Error('pdf boom'));
    await m.service.runDispatch('dispatch-1');
    expect(deliveryUpdates(m)[0].data).toMatchObject({ status: 'FAILED', error: 'pdf boom' });
    expect(deliveryUpdates(m)[1].data).toMatchObject({ status: 'SENT' });
  });

  it('refuses at SEND time if the entry is no longer final (unlocked/regenerated after queueing)', async () => {
    const m = make();
    seedRun(m, [entryRow('a', { status: 'DRAFT' })]);
    await m.service.runDispatch('dispatch-1');
    expect(m.whatsapp.sendTemplate).not.toHaveBeenCalled();
    expect(deliveryUpdates(m)[0].data).toMatchObject({ status: 'FAILED', error: expect.stringContaining('no longer approved') });
  });

  it('re-checks the phone at send time and re-snapshots the CURRENT amount', async () => {
    const m = make();
    seedRun(m, [entryRow('a', { finalPayable: 31000, version: 9, user: { id: 'u', name: 'A', role: 'LOADER', phoneNumber: 'n/a' } })]);
    await m.service.runDispatch('dispatch-1');
    expect(m.whatsapp.sendTemplate).not.toHaveBeenCalled();
    expect(deliveryUpdates(m)[0].data).toMatchObject({ status: 'SKIPPED_NO_PHONE', finalPayable: 31000, entryVersion: 9 });
  });

  it('an entry of another vendor / deleted entry is a FAILED row, never sent', async () => {
    const m = make();
    seedRun(m, [entryRow('a')]);
    m.prisma.payrollEntry.findFirst.mockResolvedValue(null);
    await m.service.runDispatch('dispatch-1');
    expect(m.whatsapp.sendTemplate).not.toHaveBeenCalled();
    expect(deliveryUpdates(m)[0].data).toMatchObject({ status: 'FAILED', error: expect.stringContaining('no longer exists') });
  });

  it.each(['COMPLETED', 'ABORTED', 'FAILED'])('is a no-op for a %s dispatch (re-delivered job cannot re-send)', async (status) => {
    const m = make();
    seedRun(m, [entryRow('a')], { status });
    await m.service.runDispatch('dispatch-1');
    expect(m.whatsapp.sendTemplate).not.toHaveBeenCalled();
    expect(m.prisma.payrollSlipDispatch.update).not.toHaveBeenCalled();
  });

  it('only picks up rows still QUEUED (a resumed run never re-sends a SENT row)', async () => {
    const m = make();
    seedRun(m, [entryRow('a')]);
    await m.service.runDispatch('dispatch-1');
    expect(m.prisma.payrollSlipDelivery.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { dispatchId: 'dispatch-1', status: 'QUEUED' } }));
  });

  it('claims every row (QUEUED -> SENDING) BEFORE its WhatsApp call, and a lost claim is never sent', async () => {
    const m = make();
    seedRun(m, [entryRow('a'), entryRow('b')]);
    const order: string[] = [];
    m.prisma.payrollSlipDelivery.updateMany.mockImplementation(async ({ where, data }: any) => {
      if (data?.status === 'SENDING') {
        order.push('claim:' + where.id);
        return { count: where.id === 'del-1' ? 0 : 1 }; // another worker already claimed del-1
      }
      return { count: 0 };
    });
    m.whatsapp.sendTemplate.mockImplementation(async () => { order.push('send'); return true; });
    await m.service.runDispatch('dispatch-1');
    expect(order).toEqual(['claim:del-0', 'send', 'claim:del-1']);
    expect(m.whatsapp.sendTemplate).toHaveBeenCalledTimes(1);
  });

  it('a re-run never re-sends a row left SENDING by a dead worker: it is reported FAILED/Interrupted instead', async () => {
    const m = make();
    seedRun(m, []);
    m.prisma.payrollSlipDelivery.updateMany.mockImplementation(async ({ where }: any) => ({ count: where?.status === 'SENDING' ? 2 : 0 }));
    await m.service.runDispatch('dispatch-1');
    expect(m.prisma.payrollSlipDelivery.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { dispatchId: 'dispatch-1', status: 'SENDING' }, data: expect.objectContaining({ status: 'FAILED', error: expect.stringContaining('Interrupted') }) }),
    );
    expect(m.whatsapp.sendTemplate).not.toHaveBeenCalled();
    expect(lastDispatchUpdate(m)).toMatchObject({ failed: 2 });
  });

  it('stops the batch after 5 failures in a row: the rest are FAILED (not attempted), dispatch ABORTED, no more sends', async () => {
    const m = make();
    seedRun(m, Array.from({ length: 8 }, (_, i) => entryRow('e' + i)));
    m.whatsapp.sendTemplate.mockResolvedValue(false);
    m.prisma.payrollSlipDelivery.updateMany.mockImplementation(async ({ where }: any) => ({ count: typeof where?.id === 'string' ? 1 : where?.id?.in ? 3 : 0 }));
    await m.service.runDispatch('dispatch-1');
    expect(m.whatsapp.sendTemplate).toHaveBeenCalledTimes(5);
    expect(m.prisma.payrollSlipDelivery.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['del-5', 'del-6', 'del-7'] }, status: 'QUEUED' }, data: expect.objectContaining({ status: 'FAILED', error: expect.stringContaining('stopped after 5 failures') }) }),
    );
    expect(lastDispatchUpdate(m)).toMatchObject({ status: 'ABORTED', failed: 8 });
  });

  it('a success in between resets the failure streak', async () => {
    const m = make();
    seedRun(m, Array.from({ length: 9 }, (_, i) => entryRow('e' + i)));
    const results = [false, false, false, false, true, false, false, false, false];
    m.whatsapp.sendTemplate.mockImplementation(async () => results.shift());
    await m.service.runDispatch('dispatch-1');
    expect(m.whatsapp.sendTemplate).toHaveBeenCalledTimes(9);
    expect(lastDispatchUpdate(m)).toMatchObject({ status: 'COMPLETED', sent: 1, failed: 8 });
  });

  it('never reaches a real provider: only the injected WhatsAppService mock is used', async () => {
    const m = make();
    seedRun(m, [entryRow('a')]);
    await m.service.runDispatch('dispatch-1');
    expect(m.whatsapp.sendTemplate).toHaveBeenCalled(); // mock — no network in this spec
  });
});

describe('PayrollSlipService.slipPdf (download)', () => {
  it('builds the slip from the vendor-scoped entry and returns the PDF + a safe filename', async () => {
    const m = make();
    m.prisma.payrollEntry.findFirst.mockResolvedValue({ ...entryRow('e1'), period });
    const out = await m.service.slipPdf(user, 'e1');
    expect(m.prisma.payrollEntry.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'e1', vendorId: 'vendor-A' } }));
    expect(out.filename).toBe('Salary-Slip-2026-09-Emp-e1.pdf');
    expect(out.buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('404s for an entry of another vendor (never renders it)', async () => {
    const m = make();
    m.prisma.payrollEntry.findFirst.mockResolvedValue(null);
    await expect(m.service.slipPdf(user, 'foreign')).rejects.toBeInstanceOf(NotFoundException);
    expect(m.pdf.generate).not.toHaveBeenCalled();
  });
});

describe('PayrollSlipService.sendDelay (randomized, 5–12s)', () => {
  function realDelay() {
    const m = make();
    (m.delaySpy as jest.SpyInstance).mockRestore();
    const sleep = jest.spyOn(m.service as any, 'sleep').mockResolvedValue(undefined);
    return { m, sleep };
  }
  afterEach(() => jest.restoreAllMocks());

  it('uses Math.random between the min and max — the bounds are 5000 and 12000', async () => {
    expect(SLIP_SEND_DELAY_MIN_MS).toBe(5000);
    expect(SLIP_SEND_DELAY_MAX_MS).toBe(12000);
    const { m, sleep } = realDelay();
    jest.spyOn(Math, 'random').mockReturnValue(0);
    await (m.service as any).sendDelay();
    jest.spyOn(Math, 'random').mockReturnValue(0.999999);
    await (m.service as any).sendDelay();
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
    await (m.service as any).sendDelay();
    const ms = sleep.mock.calls.map((c) => c[0] as number);
    expect(ms[0]).toBe(5000);
    expect(ms[1]).toBeLessThan(12000);
    expect(ms[1]).toBeGreaterThan(11990);
    expect(ms[2]).toBe(8500);
  });

  it('is not a static interval: different random draws give different pauses', async () => {
    const { m, sleep } = realDelay();
    for (let i = 0; i < 20; i++) await (m.service as any).sendDelay();
    const distinct = new Set(sleep.mock.calls.map((c) => c[0]));
    expect(distinct.size).toBeGreaterThan(1);
  });
});

describe('PayrollSlipService.status / dispatchDetail', () => {
  it('status is vendor-scoped and reports last state + amount-changed per entry, and the active dispatch', async () => {
    const m = make();
    m.prisma.payrollSlipDelivery.findMany.mockResolvedValue([
      { payrollEntryId: 'e1', status: 'FAILED', error: 'x', sentAt: null, createdAt: new Date('2026-10-03'), finalPayable: 25000 },
      { payrollEntryId: 'e1', status: 'SENT', error: null, sentAt: new Date('2026-10-02'), createdAt: new Date('2026-10-02'), finalPayable: 24000 },
    ]);
    m.prisma.payrollEntry.findMany.mockResolvedValue([{ id: 'e1', finalPayable: 25000 }]);
    m.prisma.payrollSlipDispatch.findMany.mockResolvedValue([{ id: 'd1', status: 'RUNNING', createdAt: new Date() }]);
    m.prisma.payrollSlipDispatch.findFirst.mockResolvedValue({ id: 'd1', status: 'RUNNING', createdAt: new Date() });
    const out = await m.service.status(user, 'period-1');
    expect(m.prisma.payrollSlipDelivery.findMany.mock.calls[0][0].where).toEqual({ vendorId: 'vendor-A', periodId: 'period-1' });
    expect(out.entries.e1.last).toMatchObject({ status: 'FAILED' });
    expect(out.entries.e1.lastSent).toMatchObject({ finalPayable: 24000, amountChanged: true });
    expect(out.activeDispatch).toMatchObject({ id: 'd1' });
  });

  it('a QUEUED row abandoned by a dead worker (> 6h) shows as FAILED/Interrupted, never "Sending…" forever', async () => {
    const m = make();
    m.prisma.payrollSlipDelivery.findMany.mockResolvedValue([
      { payrollEntryId: 'e1', status: 'QUEUED', error: null, sentAt: null, createdAt: new Date(Date.now() - 7 * 3600 * 1000), finalPayable: 1 },
      { payrollEntryId: 'e2', status: 'QUEUED', error: null, sentAt: null, createdAt: new Date(), finalPayable: 1 },
    ]);
    const out = await m.service.status(user, 'period-1');
    expect(out.entries.e1.last).toMatchObject({ status: 'FAILED', error: expect.stringContaining('Interrupted') });
    expect(out.entries.e2.last).toMatchObject({ status: 'QUEUED' });
  });

  it('send() takes a per-vendor advisory lock inside the creating transaction and re-checks for an active dispatch under it', async () => {
    const m = make();
    seedEntries(m, [entryRow('e1')]);
    await m.service.send(user, 'period-1', {});
    expect(m.prisma.$executeRaw).toHaveBeenCalledTimes(1);
    // checked once up-front and once under the lock
    expect(m.prisma.payrollSlipDispatch.findFirst).toHaveBeenCalledTimes(2);
  });

  it('the active dispatch is looked up VENDOR-WIDE (a send running for another period still shows)', async () => {
    const m = make();
    m.prisma.payrollSlipDispatch.findFirst.mockResolvedValue({ id: 'other-period-dispatch', periodId: 'period-OTHER', status: 'RUNNING', createdAt: new Date() });
    const out = await m.service.status(user, 'period-1');
    expect(out.activeDispatch).toMatchObject({ id: 'other-period-dispatch' });
    const where = m.prisma.payrollSlipDispatch.findFirst.mock.calls[0][0].where;
    expect(where.vendorId).toBe('vendor-A');
    expect(where.periodId).toBeUndefined();
  });

  it('"live" means QUEUED < 15 min or RUNNING < 6 h — a dispatch that never reached a worker stops blocking', async () => {
    const m = make();
    await m.service.status(user, 'period-1');
    const or = m.prisma.payrollSlipDispatch.findFirst.mock.calls[0][0].where.OR;
    const queued = or.find((c: any) => c.status === 'QUEUED');
    const running = or.find((c: any) => c.status === 'RUNNING');
    expect(Date.now() - queued.createdAt.gte.getTime()).toBeLessThanOrEqual(15 * 60 * 1000 + 1000);
    expect(Date.now() - running.createdAt.gte.getTime()).toBeLessThanOrEqual(6 * 3600 * 1000 + 1000);
    expect(Date.now() - queued.createdAt.gte.getTime()).toBeGreaterThan(14 * 60 * 1000);
  });

  it('dispatchDetail is vendor-scoped (404 for another vendor) and resolves names', async () => {
    const m = make();
    m.prisma.payrollSlipDispatch.findFirst = jest.fn().mockResolvedValue(null);
    await expect(m.service.dispatchDetail(user, 'foreign')).rejects.toBeInstanceOf(NotFoundException);
    expect(m.prisma.payrollSlipDispatch.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'foreign', vendorId: 'vendor-A' } }));
  });
});
