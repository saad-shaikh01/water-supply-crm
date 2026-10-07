import { randomUUID } from 'crypto';
import { PrismaService } from '@water-supply-crm/database';
import {
  AttendanceSource,
  AttendanceStatus,
  PayFrequency,
  PayrollSlipDeliveryStatus,
  PayrollSlipDispatchStatus,
  SettlementMethod,
  StaffLedgerCategory,
  UserRole,
} from '@prisma/client';
import type { AuthUser } from '@water-supply-crm/types';
import { PayrollApprovalGateService } from './payroll-approval-gate.service';
import { StaffLedgerService } from './staff-ledger.service';
import { PayrollEntryService } from './payroll-entry.service';
import { PayrollPeriodService } from './payroll-period.service';
import { StaffAdvancePlanService } from './staff-advance-plan.service';
import { StaffAttendanceService } from './staff-attendance.service';
import { SettlementService } from './settlement.service';
import { PayrollExportService } from './payroll-export.service';
import { PayrollSlipService } from './payroll-slip.service';
import { SalarySlipPdfService } from './salary-slip-pdf.service';
import { AbsenceDecisionAction } from './dto/resolve-absence-deduction.dto';
import { CloudTemplateNames } from '../whatsapp/templates/cloud-template-names';

/**
 * Real-database integration test for the Monthly Payroll CSV export + salary-slip WhatsApp send.
 * No mocked Prisma: real entries / attendance / ledger / settlements, the real slip builder, real PDF, real
 * Postgres constraints. ONLY the WhatsApp provider (never a real message) and the BullMQ queue are doubles;
 * the queued job is run by calling `runDispatch` directly, exactly what the processor does.
 *
 * Needs a reachable Postgres at DATABASE_URL (see payroll-integration.spec.ts). Every row hangs off throwaway
 * vendors and is deleted afterwards, scoped by vendorId.
 */
jest.setTimeout(120000);

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://admin:admin123@localhost:5432/water_supply_crm?schema=public';
const RUN_ID = randomUUID().slice(0, 8);

const prisma = new PrismaService({ datasourceUrl: DATABASE_URL });
const unusedPermissions = { can: async () => true } as any;
const passThroughPeriodGuard = { assertWritable: async () => undefined } as any;

const approvalGate = new PayrollApprovalGateService(prisma);
const staffLedger = new StaffLedgerService(prisma, approvalGate, unusedPermissions, passThroughPeriodGuard);
const advancePlans = new StaffAdvancePlanService(prisma, staffLedger, unusedPermissions);
const entries = new PayrollEntryService(prisma, unusedPermissions, advancePlans);
const periods = new PayrollPeriodService(prisma, entries, advancePlans);
const attendance = new StaffAttendanceService(prisma, unusedPermissions, staffLedger, { assertExists: async () => undefined } as any, entries);
const settlements = new SettlementService(prisma, unusedPermissions);
const exporter = new PayrollExportService(prisma, entries);

const whatsapp = { isReady: jest.fn(), sendTemplate: jest.fn() };
const queue = { add: jest.fn() };
const slips = new PayrollSlipService(prisma, entries, new SalarySlipPdfService(), whatsapp as any, queue as any);
jest.spyOn(slips as any, 'sendDelay').mockResolvedValue(undefined); // never really sleep

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const endOf = (s: string) => new Date(`${s}T23:59:59.999Z`);

let phoneSeq = 0;
const uniquePhone = () => `0300${RUN_ID.replace(/\D/g, '').padEnd(3, '7').slice(0, 3)}${String(1000 + phoneSeq++).padStart(4, '0')}`;

interface World {
  vendorId: string;
  admin: AuthUser;
  periodId: string;
  monthly: { id: string; phone: string };
  daily: { id: string; phone: string };
  noPhone: { id: string };
}

const vendorIds: string[] = [];

async function makeWorld(label: string): Promise<World> {
  const vendor = await prisma.vendor.create({ data: { name: `Slip ${label} ${RUN_ID}`, slug: `slip-${label}-${RUN_ID}` } });
  vendorIds.push(vendor.id);
  const vendorId = vendor.id;
  const adminRow = await prisma.user.create({
    data: { vendorId, role: UserRole.VENDOR_ADMIN, name: `Admin ${label}`, email: `slip-admin-${label}-${RUN_ID}@test.local` },
  });
  const mkUser = async (name: string, role: UserRole, base: number, freq: PayFrequency, phoneNumber: string | null) => {
    const u = await prisma.user.create({
      data: { vendorId, role, name: `${name} ${label}`, email: `slip-${name}-${label}-${RUN_ID}@test.local`, phoneNumber },
    });
    await prisma.salaryStructure.create({
      data: { vendorId, userId: u.id, baseAmount: base, payFrequency: freq, effectiveFrom: d('2026-01-01'), createdById: adminRow.id },
    });
    return u;
  };
  const monthlyPhone = uniquePhone();
  const dailyPhone = uniquePhone();
  const monthly = await mkUser('Monthly', UserRole.DRIVER, 30000, PayFrequency.MONTHLY, monthlyPhone);
  const daily = await mkUser('Daily', UserRole.LOADER, 1000, PayFrequency.DAILY, dailyPhone);
  const noPhone = await mkUser('NoPhone', UserRole.LOADER, 20000, PayFrequency.MONTHLY, null);
  await prisma.payrollVendorConfig.create({ data: { vendorId, cutoffDay: 1, autoLockEnabled: false, updatedById: adminRow.id } });
  const sep = await prisma.payrollPeriod.create({
    data: { vendorId, periodLabel: '2026-09', startDate: d('2026-09-01'), endDate: endOf('2026-09-30') },
  });
  return {
    vendorId,
    admin: { userId: adminRow.id, email: adminRow.email as string, name: adminRow.name, role: 'VENDOR_ADMIN', vendorId, customerId: null },
    periodId: sep.id,
    monthly: { id: monthly.id, phone: monthlyPhone },
    daily: { id: daily.id, phone: dailyPhone },
    noPhone: { id: noPhone.id },
  };
}

async function mark(w: World, userId: string, date: string, status: AttendanceStatus) {
  return prisma.staffAttendance.create({
    data: { vendorId: w.vendorId, userId, date: d(date), status, source: AttendanceSource.CREW_CONFIRM, markedById: w.admin.userId },
  });
}

const entryOf = (periodId: string, userId: string) =>
  prisma.payrollEntry.findUniqueOrThrow({ where: { periodId_userId: { periodId, userId } } });

async function approveAll(w: World) {
  for (const e of await prisma.payrollEntry.findMany({ where: { vendorId: w.vendorId, periodId: w.periodId } })) {
    await entries.approveEntry(w.admin, e.id, e.version, true);
  }
}

/** Runs the job that `send()` just queued, like the processor does. */
async function runQueued(dispatchId: string) {
  await slips.runDispatch(dispatchId);
  return prisma.payrollSlipDispatch.findUniqueOrThrow({ where: { id: dispatchId }, include: { deliveries: true } });
}

async function cleanup(vendorId: string) {
  if (!vendorId) return;
  await prisma.payrollSlipDelivery.deleteMany({ where: { vendorId } });
  await prisma.payrollSlipDispatch.deleteMany({ where: { vendorId } });
  await prisma.settlement.deleteMany({ where: { vendorId } });
  await prisma.payrollEntryAuditLog.deleteMany({ where: { payrollEntry: { vendorId } } });
  await prisma.payrollSnapshot.deleteMany({ where: { payrollEntry: { vendorId } } });
  await prisma.staffAttendance.deleteMany({ where: { vendorId } });
  await prisma.staffLedgerAuditLog.deleteMany({ where: { ledgerEntry: { vendorId } } });
  await prisma.staffLedgerEntry.deleteMany({ where: { vendorId } });
  await prisma.staffAdvanceInstallment.deleteMany({ where: { vendorId } });
  await prisma.payrollEntry.deleteMany({ where: { vendorId } });
  await prisma.payrollPeriod.deleteMany({ where: { vendorId } });
  await prisma.salaryStructure.deleteMany({ where: { vendorId } });
  await prisma.payrollVendorConfig.deleteMany({ where: { vendorId } });
  await prisma.user.deleteMany({ where: { vendorId } });
  await prisma.vendor.delete({ where: { id: vendorId } });
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    throw new Error(
      'payroll-slip-export.integration.spec.ts requires a reachable Postgres at DATABASE_URL ' +
        '(see payroll-integration.spec.ts). Original error: ' + (err instanceof Error ? err.message : String(err)),
    );
  }
});

beforeEach(() => {
  whatsapp.isReady.mockReset().mockReturnValue(true);
  whatsapp.sendTemplate.mockReset().mockResolvedValue(true);
  queue.add.mockReset().mockResolvedValue({});
});

afterAll(async () => {
  try {
    for (const id of vendorIds) await cleanup(id);
  } finally {
    await prisma.$disconnect();
  }
});

describe('salary slips + CSV export (real DB)', () => {
  let w: World;
  let other: World; // a second vendor — nothing of it may leak into w, and vice versa

  beforeAll(async () => {
    w = await makeWorld('a');
    other = await makeWorld('b');

    // Monthly employee: 3 absent days -> 2 deducted (1,000 each), 1 paid; plus a Rs 1,500 advance.
    for (const day of ['03', '04', '05']) await mark(w, w.monthly.id, `2026-09-${day}`, AttendanceStatus.ABSENT);
    await mark(w, w.monthly.id, '2026-09-10', AttendanceStatus.PRESENT);
    await mark(w, w.daily.id, '2026-09-03', AttendanceStatus.ABSENT);
    await mark(w, w.daily.id, '2026-09-04', AttendanceStatus.PRESENT);
    await staffLedger.create(w.admin, { userId: w.monthly.id, category: StaffLedgerCategory.ADVANCE, amount: -1500, effectiveDate: d('2026-09-12').toISOString(), description: 'itest advance' } as any);

    await entries.generateDraft(w.admin, w.periodId);
    await attendance.resolveAbsenceDecisions(w.admin, { userId: w.monthly.id, dates: ['2026-09-03', '2026-09-04'], action: AbsenceDecisionAction.UNPAID, dailyRate: 1000 });
    await attendance.resolveAbsenceDecisions(w.admin, { userId: w.monthly.id, dates: ['2026-09-05'], action: AbsenceDecisionAction.WAIVE, note: 'approved leave' });
    await entries.generateDraft(w.admin, w.periodId);

    // the other vendor has its own entries (DRAFT) that must never show up for `w`
    await entries.generateDraft(other.admin, other.periodId);
  });

  it('1. DRAFT entries cannot be sent: preview says why, send refuses and creates nothing', async () => {
    const preview = await slips.preview(w.admin, w.periodId, {});
    expect(preview.items).toHaveLength(3);
    expect(preview.items.every((i) => i.verdict === 'NOT_FINAL' && i.reason)).toBe(true);
    await expect(slips.send(w.admin, w.periodId, {})).rejects.toThrow(/not approved/);
    expect(await prisma.payrollSlipDispatch.count({ where: { vendorId: w.vendorId } })).toBe(0);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('2. breakdown exposes the per-day deducted amount the slip needs', async () => {
    const monthly = await entryOf(w.periodId, w.monthly.id);
    const breakdown = await entries.getBreakdown(w.admin, monthly.id);
    expect(breakdown.attendance.days.map((x) => [x.decision, x.deductedAmount, x.deductionDeferred])).toEqual([
      ['DEDUCTED', 1000, false],
      ['DEDUCTED', 1000, false],
      ['WAIVED', 0, false],
      [null, 0, false],
    ]);
  });

  it('3. after approval: sendable = monthly + daily, no-phone is flagged', async () => {
    await approveAll(w);
    const preview = await slips.preview(w.admin, w.periodId, {});
    const by = Object.fromEntries(preview.items.map((i) => [i.userId, i]));
    expect(by[w.monthly.id].verdict).toBe('ELIGIBLE');
    expect(by[w.daily.id].verdict).toBe('ELIGIBLE');
    expect(by[w.noPhone.id].verdict).toBe('NO_PHONE');
    expect(preview.counts).toMatchObject({ total: 3, eligible: 2, noPhone: 1, notFinal: 0 });
  });

  it('4. send queues one job; running it sends the right slip to the right phone and logs every result', async () => {
    const out = await slips.send(w.admin, w.periodId, {});
    expect(out.queued).toBe(2);
    expect(out.skippedNoPhone).toHaveLength(1);
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(whatsapp.sendTemplate).not.toHaveBeenCalled(); // the request itself sends nothing

    const queuedRows = await prisma.payrollSlipDelivery.findMany({ where: { dispatchId: out.dispatchId } });
    expect(queuedRows.map((r) => r.status).sort()).toEqual([
      PayrollSlipDeliveryStatus.QUEUED,
      PayrollSlipDeliveryStatus.QUEUED,
      PayrollSlipDeliveryStatus.SKIPPED_NO_PHONE,
    ]);

    const done = await runQueued(out.dispatchId);
    expect(done).toMatchObject({ status: PayrollSlipDispatchStatus.COMPLETED, total: 3, sent: 2, skipped: 1, failed: 0 });
    expect(done.finishedAt).not.toBeNull();

    expect(whatsapp.sendTemplate).toHaveBeenCalledTimes(2);
    const calls = whatsapp.sendTemplate.mock.calls;
    const monthlyEntry = await entryOf(w.periodId, w.monthly.id);
    const dailyEntry = await entryOf(w.periodId, w.daily.id);
    // 30,000 base - 2,000 absence - 1,500 advance
    expect(monthlyEntry.finalPayable).toBe(26500);
    const monthlyCall = calls.find((c) => c[0] === `92${w.monthly.phone.slice(1)}`)!;
    expect(monthlyCall[1]).toBe(CloudTemplateNames.SALARY_SLIP);
    expect(monthlyCall[2]).toEqual([`Monthly a`, '2026-09', '26,500']);
    expect(monthlyCall[3].buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(monthlyCall[3].filename).toBe('Salary-Slip-2026-09-Monthly-a.pdf');
    const dailyCall = calls.find((c) => c[0] === `92${w.daily.phone.slice(1)}`)!;
    expect(dailyCall[2][2]).toBe(dailyEntry.finalPayable.toLocaleString('en-US'));
    // each call carries ONLY that employee's name — never another employee's data
    expect(calls.every((c) => [`Monthly a`, `Daily a`].includes(c[2][0]))).toBe(true);

    const rows = Object.fromEntries(done.deliveries.map((r) => [r.userId, r]));
    expect(rows[w.monthly.id]).toMatchObject({ status: 'SENT', finalPayable: 26500, entryVersion: monthlyEntry.version, vendorId: w.vendorId });
    expect(rows[w.monthly.id].sentAt).not.toBeNull();
    expect(rows[w.noPhone.id]).toMatchObject({ status: 'SKIPPED_NO_PHONE', phone: null });
  });

  it('5. status reports the sent state per entry; re-sending needs confirmation', async () => {
    const status = await slips.status(w.admin, w.periodId);
    const monthlyEntry = await entryOf(w.periodId, w.monthly.id);
    expect(status.entries[monthlyEntry.id].lastSent).toMatchObject({ finalPayable: 26500, amountChanged: false });
    expect(status.activeDispatch).toBeNull();

    const err: any = await slips.send(w.admin, w.periodId, {}).catch((e) => e);
    expect(err.getResponse()).toMatchObject({ code: 'SLIP_ALREADY_SENT' });
    expect(err.getResponse().alreadySent).toHaveLength(2);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('6. skipAlreadySent with only the no-phone left completes immediately and queues nothing', async () => {
    const out = await slips.send(w.admin, w.periodId, { skipAlreadySent: true });
    expect(out).toMatchObject({ queued: 0, status: 'COMPLETED' });
    expect(out.skippedAlreadySent).toHaveLength(2);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('7. "send specific": only the chosen entry is sent (with confirmResend), the other is untouched', async () => {
    const dailyEntry = await entryOf(w.periodId, w.daily.id);
    const out = await slips.send(w.admin, w.periodId, { entryIds: [dailyEntry.id], confirmResend: true });
    expect(out.queued).toBe(1);
    const done = await runQueued(out.dispatchId);
    expect(done.deliveries).toHaveLength(1);
    expect(whatsapp.sendTemplate).toHaveBeenCalledTimes(1);
    expect(whatsapp.sendTemplate.mock.calls[0][0]).toBe(`92${w.daily.phone.slice(1)}`);
  });

  it('8. an amount change after sending is flagged (status + preview) until re-sent', async () => {
    await staffLedger.create(w.admin, { userId: w.monthly.id, category: StaffLedgerCategory.BONUS, amount: 1000, effectiveDate: d('2026-09-20').toISOString(), description: 'late bonus' } as any);
    const e = await entryOf(w.periodId, w.monthly.id);
    await entries.recalculateEntry(w.admin, e.id, e.version);
    const after = await entryOf(w.periodId, w.monthly.id);
    expect(after.finalPayable).toBe(27500);

    const status = await slips.status(w.admin, w.periodId);
    expect(status.entries[after.id].lastSent).toMatchObject({ finalPayable: 26500, amountChanged: true });
    const preview = await slips.preview(w.admin, w.periodId, { entryIds: [after.id] });
    expect(preview.items[0].alreadySent).toMatchObject({ finalPayable: 26500, amountChanged: true });

    const out = await slips.send(w.admin, w.periodId, { entryIds: [after.id], confirmResend: true });
    await runQueued(out.dispatchId);
    expect(whatsapp.sendTemplate.mock.calls[0][2][2]).toBe('27,500');
    expect((await slips.status(w.admin, w.periodId)).entries[after.id].lastSent).toMatchObject({ finalPayable: 27500, amountChanged: false });
  });

  it('9. WhatsApp drops mid-batch: first goes out, the rest are persisted SKIPPED_DISCONNECTED and the dispatch is ABORTED', async () => {
    const out = await slips.send(w.admin, w.periodId, { confirmResend: true });
    whatsapp.isReady.mockReturnValueOnce(true).mockReturnValue(false);
    const done = await runQueued(out.dispatchId);
    expect(whatsapp.sendTemplate).toHaveBeenCalledTimes(1);
    expect(done.status).toBe(PayrollSlipDispatchStatus.ABORTED);
    const byStatus = done.deliveries.map((r) => r.status).sort();
    expect(byStatus).toEqual(['SENT', 'SKIPPED_DISCONNECTED', 'SKIPPED_NO_PHONE']);
    expect(done).toMatchObject({ sent: 1, skipped: 2 });
  });

  it('10. a failed send is logged FAILED and does not count as "already sent"', async () => {
    // a fresh vendor-world entry that was never sent
    const fresh = await makeWorld('c');
    await entries.generateDraft(fresh.admin, fresh.periodId);
    await approveAll(fresh);
    whatsapp.sendTemplate.mockResolvedValue(false);
    const out = await slips.send(fresh.admin, fresh.periodId, {});
    const done = await runQueued(out.dispatchId);
    expect(done).toMatchObject({ sent: 0, failed: 2, status: 'COMPLETED' });
    expect(done.deliveries.filter((r) => r.status === 'FAILED').every((r) => !!r.error)).toBe(true);
    // not "already sent": sending again needs no confirmation
    whatsapp.sendTemplate.mockResolvedValue(true);
    await expect(slips.send(fresh.admin, fresh.periodId, {})).resolves.toMatchObject({ queued: 2 });
  });

  it('11. only one active send per vendor at a time (real dispatch row)', async () => {
    const dispatch = await prisma.payrollSlipDispatch.create({
      data: { vendorId: w.vendorId, periodId: w.periodId, requestedById: w.admin.userId, total: 1, status: PayrollSlipDispatchStatus.RUNNING },
    });
    const err: any = await slips.send(w.admin, w.periodId, { confirmResend: true }).catch((e) => e);
    expect(err.getResponse()).toMatchObject({ code: 'SLIP_DISPATCH_ACTIVE', dispatchId: dispatch.id });
    expect((await slips.status(w.admin, w.periodId)).activeDispatch?.id).toBe(dispatch.id);
    await prisma.payrollSlipDispatch.delete({ where: { id: dispatch.id } });
  });

  it('12. vendor isolation: foreign period / entries / dispatches are invisible', async () => {
    const otherEntry = await prisma.payrollEntry.findFirstOrThrow({ where: { vendorId: other.vendorId } });
    await expect(slips.preview(w.admin, other.periodId, {})).rejects.toThrow(/not found/i);
    await expect(slips.send(w.admin, other.periodId, {})).rejects.toThrow(/not found/i);
    await expect(slips.status(w.admin, other.periodId)).rejects.toThrow(/not found/i);
    // own period + foreign entry id
    await expect(slips.send(w.admin, w.periodId, { entryIds: [otherEntry.id], confirmResend: true })).rejects.toThrow(/not found/i);
    // slip builder is vendor-scoped too
    expect(await slips.buildSlipForEntry(w.vendorId, otherEntry.id)).toBeNull();
    // someone else's dispatch
    const mine = await prisma.payrollSlipDispatch.findFirstOrThrow({ where: { vendorId: w.vendorId } });
    await expect(slips.dispatchDetail(other.admin, mine.id)).rejects.toThrow(/not found/i);
    const detail = await slips.dispatchDetail(w.admin, mine.id);
    expect(detail.deliveries.every((r) => r.name.endsWith(' a'))).toBe(true);
    // the other vendor has no slip rows
    expect(await prisma.payrollSlipDelivery.count({ where: { vendorId: other.vendorId } })).toBe(0);
  });

  it('13. the slip PDF content is built from that employee only (absence breakdown included)', async () => {
    const monthlyEntry = await entryOf(w.periodId, w.monthly.id);
    const built = await slips.buildSlipForEntry(w.vendorId, monthlyEntry.id);
    expect(built?.slip).toMatchObject({
      employeeName: 'Monthly a',
      periodLabel: '2026-09',
      absence: { decisionsApply: true, deductedDays: 2, deductedAmount: 2000, waivedDays: 1, pendingDays: 0 },
    });
    expect(built?.phone).toBe(`92${w.monthly.phone.slice(1)}`);
    const dailyBuilt = await slips.buildSlipForEntry(w.vendorId, (await entryOf(w.periodId, w.daily.id)).id);
    expect(dailyBuilt?.slip.absence.decisionsApply).toBe(false); // DAILY: absence already in base pay
  });

  it('14. CSV export: one row per employee with settled/balance/pending days, vendor-scoped, locked period too', async () => {
    const live = await exporter.exportPeriodCsv(w.admin, w.periodId);
    const lines = live.body.replace('﻿', '').split('\r\n').filter(Boolean);
    expect(lines).toHaveLength(4); // header + 3 employees
    const monthlyLine = lines.find((l) => l.includes('Monthly a'))!.split(',');
    expect(monthlyLine[1]).toBe('Monthly a');
    expect(monthlyLine[14]).toBe('27500.00'); // final payable
    expect(monthlyLine[16]).toBe('0.00');
    expect(monthlyLine[17]).toBe('27500.00'); // balance
    expect(live.body).not.toContain('Monthly b'); // other vendor's employees never appear

    // lock + settle part of it -> the SAME export on a historical period reflects settlements
    await periods.lockPeriod(w.admin, w.periodId);
    const locked = await entryOf(w.periodId, w.monthly.id);
    await settlements.record(w.admin, locked.id, { amount: 10000, method: SettlementMethod.CASH } as any);
    const historical = await exporter.exportPeriodCsv(w.admin, w.periodId);
    const histLine = historical.body.split('\r\n').find((l) => l.includes('Monthly a'))!.split(',');
    expect(histLine[15]).toBe('LOCKED');
    expect(histLine[16]).toBe('10000.00');
    expect(histLine[17]).toBe(`${locked.finalPayable - 10000}.00`);
    await expect(exporter.exportPeriodCsv(w.admin, other.periodId)).rejects.toThrow(/not found/i);
  });

  it('15. a locked/settled entry is still sendable (final payable is fixed)', async () => {
    const preview = await slips.preview(w.admin, w.periodId, {});
    expect(preview.counts.notFinal).toBe(0);
    expect(preview.items.find((i) => i.userId === w.monthly.id)).toMatchObject({ verdict: 'ELIGIBLE', status: 'LOCKED' });
  });

  it('17. two simultaneous sends (double-click / two admins): exactly one dispatch is created, the other gets 409', async () => {
    const fresh = await makeWorld('d');
    await entries.generateDraft(fresh.admin, fresh.periodId);
    await approveAll(fresh);
    const results = await Promise.allSettled([
      slips.send(fresh.admin, fresh.periodId, {}),
      slips.send(fresh.admin, fresh.periodId, {}),
      slips.send(fresh.admin, fresh.periodId, {}),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected).toHaveLength(2);
    expect(rejected.every((r) => r.reason?.getResponse?.().code === 'SLIP_DISPATCH_ACTIVE')).toBe(true);
    expect(await prisma.payrollSlipDispatch.count({ where: { vendorId: fresh.vendorId } })).toBe(1);
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  it('18. the SAME job run twice at once (stalled-job re-delivery / two workers) sends each slip exactly once', async () => {
    const fresh = await makeWorld('e');
    await entries.generateDraft(fresh.admin, fresh.periodId);
    await approveAll(fresh);
    const out = await slips.send(fresh.admin, fresh.periodId, {});
    await Promise.all([slips.runDispatch(out.dispatchId), slips.runDispatch(out.dispatchId)]);
    expect(whatsapp.sendTemplate).toHaveBeenCalledTimes(2); // 2 employees with a phone, once each
    const rows = await prisma.payrollSlipDelivery.findMany({ where: { dispatchId: out.dispatchId } });
    expect(rows.filter((r) => r.status === 'SENT')).toHaveLength(2);
    // and a third, later re-run is a no-op
    await slips.runDispatch(out.dispatchId);
    expect(whatsapp.sendTemplate).toHaveBeenCalledTimes(2);
  });

  it('19. a row left SENDING by a crashed worker is never re-sent: the re-run reports it as Interrupted', async () => {
    const fresh = await makeWorld('f');
    await entries.generateDraft(fresh.admin, fresh.periodId);
    await approveAll(fresh);
    const out = await slips.send(fresh.admin, fresh.periodId, {});
    const [first] = await prisma.payrollSlipDelivery.findMany({ where: { dispatchId: out.dispatchId, status: 'QUEUED' }, orderBy: { createdAt: 'asc' } });
    // simulate: worker claimed row #1, called WhatsApp, then died before recording the result
    await prisma.payrollSlipDelivery.update({ where: { id: first.id }, data: { status: 'SENDING' } });
    await prisma.payrollSlipDispatch.update({ where: { id: out.dispatchId }, data: { status: 'RUNNING' } });
    await slips.runDispatch(out.dispatchId);
    expect(whatsapp.sendTemplate).toHaveBeenCalledTimes(1); // only the OTHER employee
    const row = await prisma.payrollSlipDelivery.findUniqueOrThrow({ where: { id: first.id } });
    expect(row).toMatchObject({ status: 'FAILED', error: expect.stringContaining('Interrupted') });
    const dispatch = await prisma.payrollSlipDispatch.findUniqueOrThrow({ where: { id: out.dispatchId } });
    expect(dispatch).toMatchObject({ status: 'COMPLETED', sent: 1, failed: 1 });
  });

  it('20. the active send is visible from ANY period of the vendor, and a QUEUED dispatch that never reached a worker stops blocking after 15 min', async () => {
    const fresh = await makeWorld('g');
    const otherPeriod = await prisma.payrollPeriod.create({
      data: { vendorId: fresh.vendorId, periodLabel: '2026-10', startDate: d('2026-10-01'), endDate: endOf('2026-10-31') },
    });
    const stuck = await prisma.payrollSlipDispatch.create({
      data: { vendorId: fresh.vendorId, periodId: fresh.periodId, requestedById: fresh.admin.userId, total: 1, status: PayrollSlipDispatchStatus.QUEUED },
    });
    expect((await slips.status(fresh.admin, otherPeriod.id)).activeDispatch?.id).toBe(stuck.id);
    await prisma.payrollSlipDispatch.update({ where: { id: stuck.id }, data: { createdAt: new Date(Date.now() - 20 * 60 * 1000) } });
    expect((await slips.status(fresh.admin, otherPeriod.id)).activeDispatch).toBeNull();
    await prisma.payrollSlipDispatch.delete({ where: { id: stuck.id } });
  });

  it('16. deleting a dispatch cascades its deliveries; an entry cannot be deleted while it has slip history (FK)', async () => {
    const withHistory = await prisma.payrollSlipDelivery.findFirstOrThrow({ where: { vendorId: w.vendorId, status: 'SENT' } });
    await expect(prisma.payrollEntry.delete({ where: { id: withHistory.payrollEntryId } })).rejects.toThrow();
    const dispatch = await prisma.payrollSlipDispatch.create({
      data: { vendorId: w.vendorId, periodId: w.periodId, requestedById: w.admin.userId, total: 1 },
    });
    await prisma.payrollSlipDelivery.create({
      data: { dispatchId: dispatch.id, vendorId: w.vendorId, periodId: w.periodId, payrollEntryId: withHistory.payrollEntryId, userId: withHistory.userId, finalPayable: 1, entryVersion: 1 },
    });
    await prisma.payrollSlipDispatch.delete({ where: { id: dispatch.id } });
    expect(await prisma.payrollSlipDelivery.count({ where: { dispatchId: dispatch.id } })).toBe(0);
  });
});
