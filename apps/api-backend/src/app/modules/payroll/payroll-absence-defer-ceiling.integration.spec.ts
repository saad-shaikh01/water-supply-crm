import { randomUUID } from 'crypto';
import { PrismaService } from '@water-supply-crm/database';
import {
  AttendanceSource,
  AttendanceStatus,
  LedgerEntryStatus,
  PayFrequency,
  PayrollEntryStatus,
  PayrollPeriodStatus,
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
import { StaffLedgerDeferralService } from './staff-ledger-deferral.service';
import { AbsenceDecisionAction } from './dto/resolve-absence-deduction.dto';

/**
 * Real-database integration test for the 2026-10-07 payroll work: bulk paid/unpaid absence decisions, the
 * approve gate, "deduct next month" deferral and the max-deduction ceiling - all against an actual Postgres
 * with NO mocked Prisma. The unit specs prove each piece in isolation; this file proves they compose (the
 * attribution-aware window filter, the lock claim, the carry-forward and the DB constraints/FKs).
 *
 * Needs a reachable Postgres at DATABASE_URL (see payroll-integration.spec.ts); every row it creates hangs off
 * its own throwaway vendor and is deleted afterwards, scoped by that vendorId.
 */
jest.setTimeout(90000);

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
const deferral = new StaffLedgerDeferralService(prisma, entries);

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const endOf = (s: string) => new Date(`${s}T23:59:59.999Z`);

interface World {
  vendorId: string;
  admin: AuthUser;
  monthlyId: string; // MONTHLY 30,000
  dailyId: string; // DAILY 1,000/day
  augPeriodId: string;
  sepPeriodId: string;
}

const vendorIds: string[] = [];

async function makeWorld(label: string): Promise<World> {
  const vendor = await prisma.vendor.create({
    data: { name: `Payroll Absence/Defer/Ceiling ${label} ${RUN_ID}`, slug: `payroll-adc-${label}-${RUN_ID}` },
  });
  vendorIds.push(vendor.id);
  const vendorId = vendor.id;

  const adminRow = await prisma.user.create({
    data: { vendorId, role: UserRole.VENDOR_ADMIN, name: `Admin ${label}`, email: `adc-admin-${label}-${RUN_ID}@test.local` },
  });
  const monthly = await prisma.user.create({
    data: { vendorId, role: UserRole.DRIVER, name: `Monthly ${label}`, email: `adc-monthly-${label}-${RUN_ID}@test.local` },
  });
  const daily = await prisma.user.create({
    data: { vendorId, role: UserRole.LOADER, name: `Daily ${label}`, email: `adc-daily-${label}-${RUN_ID}@test.local` },
  });

  await prisma.salaryStructure.create({
    data: { vendorId, userId: monthly.id, baseAmount: 30000, payFrequency: PayFrequency.MONTHLY, effectiveFrom: d('2026-01-01'), createdById: adminRow.id },
  });
  await prisma.salaryStructure.create({
    data: { vendorId, userId: daily.id, baseAmount: 1000, payFrequency: PayFrequency.DAILY, effectiveFrom: d('2026-01-01'), createdById: adminRow.id },
  });
  await prisma.payrollVendorConfig.create({ data: { vendorId, cutoffDay: 1, autoLockEnabled: false, updatedById: adminRow.id } });

  const aug = await prisma.payrollPeriod.create({
    data: { vendorId, periodLabel: '2026-08', startDate: d('2026-08-01'), endDate: endOf('2026-08-31') },
  });
  const sep = await prisma.payrollPeriod.create({
    data: { vendorId, periodLabel: '2026-09', startDate: d('2026-09-01'), endDate: endOf('2026-09-30') },
  });

  return {
    vendorId,
    admin: { userId: adminRow.id, email: adminRow.email as string, name: adminRow.name, role: 'VENDOR_ADMIN', vendorId, customerId: null },
    monthlyId: monthly.id,
    dailyId: daily.id,
    augPeriodId: aug.id,
    sepPeriodId: sep.id,
  };
}

async function mark(w: World, userId: string, date: string, status: AttendanceStatus) {
  return prisma.staffAttendance.create({
    data: { vendorId: w.vendorId, userId, date: d(date), status, source: AttendanceSource.CREW_CONFIRM, markedById: w.admin.userId },
  });
}

async function ledger(w: World, userId: string, category: StaffLedgerCategory, amount: number, date: string, description = 'itest') {
  return staffLedger.create(w.admin, { userId, category, amount, effectiveDate: d(date).toISOString(), description } as any);
}

async function entryOf(periodId: string, userId: string) {
  return prisma.payrollEntry.findUniqueOrThrow({ where: { periodId_userId: { periodId, userId } } });
}

async function setConfig(w: World, maxDeductionPercent: number | null) {
  await prisma.payrollVendorConfig.update({ where: { vendorId: w.vendorId }, data: { maxDeductionPercent } });
}

async function cleanup(vendorId: string) {
  if (!vendorId) return;
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
      'payroll-absence-defer-ceiling.integration.spec.ts requires a reachable Postgres at DATABASE_URL ' +
        '(see payroll-integration.spec.ts). Original error: ' + (err instanceof Error ? err.message : String(err)),
    );
  }
});

afterAll(async () => {
  try {
    for (const id of vendorIds) await cleanup(id);
  } finally {
    await prisma.$disconnect();
  }
});

describe('bulk absence decisions + approve gate (real DB)', () => {
  let w: World;
  beforeAll(async () => {
    w = await makeWorld('abs');
  });

  it('walks the whole flow: undecided -> gated approve -> bulk unpaid / paid -> exact payable -> reset -> lock freezes it', async () => {
    // 5 absent days + 1 half day (+ a present day) for the MONTHLY employee; 2 absent days for the DAILY one.
    for (const day of ['03', '04', '05', '06', '07']) await mark(w, w.monthlyId, `2026-08-${day}`, AttendanceStatus.ABSENT);
    await mark(w, w.monthlyId, '2026-08-08', AttendanceStatus.HALF_DAY);
    await mark(w, w.monthlyId, '2026-08-10', AttendanceStatus.PRESENT);
    await mark(w, w.dailyId, '2026-08-03', AttendanceStatus.ABSENT);
    await mark(w, w.dailyId, '2026-08-04', AttendanceStatus.ABSENT);
    await mark(w, w.dailyId, '2026-08-05', AttendanceStatus.PRESENT);

    await entries.generateDraft(w.admin, w.augPeriodId);
    let monthly = await entryOf(w.augPeriodId, w.monthlyId);
    expect(monthly.finalPayable).toBe(30000); // nothing decided yet: paid in full

    // The Monthly Payroll table flags the 6 undecided days - for the MONTHLY employee only.
    const rows: any[] = await entries.listForPeriod(w.admin, w.augPeriodId);
    expect(rows.find((r) => r.userId === w.monthlyId).pendingAbsenceDays).toBe(6);
    expect(rows.find((r) => r.userId === w.dailyId).pendingAbsenceDays).toBe(0);

    // Approve is refused while undecided...
    const refused: any = await entries.approveEntry(w.admin, monthly.id, monthly.version).catch((e) => e);
    expect(refused.getResponse()).toMatchObject({ code: 'PENDING_ABSENCE_DECISIONS', pendingAbsenceDays: 6 });
    expect((await entryOf(w.augPeriodId, w.monthlyId)).status).toBe(PayrollEntryStatus.DRAFT);

    // ...the breakdown tells the same story day by day.
    let breakdown = await entries.getBreakdown(w.admin, monthly.id);
    expect(breakdown.attendance.decisionsApply).toBe(true);
    expect(breakdown.attendance.pendingDecisionDays).toBe(6);
    expect(breakdown.suggestedMonthlyDailyRate).toBe(Math.round(30000 / 31));

    // Bulk: 3 unpaid + 1 half-day unpaid (rate 1000 => 1000,1000,1000 + 500), 2 paid.
    const unpaid = await attendance.resolveAbsenceDecisions(w.admin, {
      userId: w.monthlyId,
      dates: ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-08'],
      action: AbsenceDecisionAction.UNPAID,
      dailyRate: 1000,
    });
    expect(unpaid).toEqual({ action: 'UNPAID', requested: 4, affected: 4, unchanged: 0, totalDeducted: 3500, draftsRefreshed: 1 });
    const paid = await attendance.resolveAbsenceDecisions(w.admin, {
      userId: w.monthlyId,
      dates: ['2026-08-06', '2026-08-07'],
      action: AbsenceDecisionAction.WAIVE,
      note: 'Medical leave, approved',
    });
    expect(paid).toMatchObject({ affected: 2, totalDeducted: 0 });

    const leaveEntries = await prisma.staffLedgerEntry.findMany({
      where: { vendorId: w.vendorId, userId: w.monthlyId, category: StaffLedgerCategory.LEAVE_UNPAID },
      orderBy: { effectiveDate: 'asc' },
    });
    expect(leaveEntries.map((e) => [e.effectiveDate.toISOString().slice(0, 10), e.amount, e.status])).toEqual([
      ['2026-08-03', -1000, LedgerEntryStatus.POSTED],
      ['2026-08-04', -1000, LedgerEntryStatus.POSTED],
      ['2026-08-05', -1000, LedgerEntryStatus.POSTED],
      ['2026-08-08', -500, LedgerEntryStatus.POSTED],
    ]);
    const waivedRow = await prisma.staffAttendance.findUniqueOrThrow({ where: { userId_date: { userId: w.monthlyId, date: d('2026-08-06') } } });
    expect(waivedRow.deductionWaivedAt).not.toBeNull();
    expect(waivedRow.deductionWaivedById).toBe(w.admin.userId);
    expect(waivedRow.deductionWaivedReason).toBe('Medical leave, approved');
    expect(waivedRow.leaveLedgerEntryId).toBeNull();

    // Re-sending the same unpaid batch never double-charges.
    const again = await attendance.resolveAbsenceDecisions(w.admin, {
      userId: w.monthlyId,
      dates: ['2026-08-03', '2026-08-04'],
      action: AbsenceDecisionAction.UNPAID,
      dailyRate: 1000,
    });
    expect(again).toMatchObject({ affected: 0, unchanged: 2, totalDeducted: 0 });
    expect(await prisma.staffLedgerEntry.count({ where: { vendorId: w.vendorId, userId: w.monthlyId, category: StaffLedgerCategory.LEAVE_UNPAID } })).toBe(4);

    // The decisions refreshed this employee's DRAFT in the same transaction - no Generate Draft needed:
    // 30,000 - 3,500 = 26,500, nothing pending any more.
    expect(await entryOf(w.augPeriodId, w.monthlyId)).toMatchObject({ otherDeductions: -3500, finalPayable: 26500 });
    await entries.generateDraft(w.admin, w.augPeriodId);
    monthly = await entryOf(w.augPeriodId, w.monthlyId);
    expect(monthly.otherDeductions).toBe(-3500);
    expect(monthly.finalPayable).toBe(26500);
    breakdown = await entries.getBreakdown(w.admin, monthly.id);
    expect(breakdown.attendance.pendingDecisionDays).toBe(0);
    expect(breakdown.attendance.days.filter((x) => x.date).map((x) => x.decision)).toEqual([
      'DEDUCTED', 'DEDUCTED', 'DEDUCTED', 'WAIVED', 'WAIVED', 'DEDUCTED', null,
    ]);

    // A paid day cannot be waived over a live deduction; reset first.
    await expect(
      attendance.resolveAbsenceDecisions(w.admin, { userId: w.monthlyId, dates: ['2026-08-03'], action: AbsenceDecisionAction.WAIVE }),
    ).rejects.toThrow(/reset it first/);

    // Reset one deducted day: ledger entry VOIDED, pointer cleared, pending again, payable back up by 1,000.
    await attendance.resolveAbsenceDecisions(w.admin, { userId: w.monthlyId, dates: ['2026-08-04'], action: AbsenceDecisionAction.RESET, note: 'entered by mistake' });
    const voided = await prisma.staffLedgerEntry.findFirstOrThrow({
      where: { vendorId: w.vendorId, userId: w.monthlyId, effectiveDate: d('2026-08-04'), category: StaffLedgerCategory.LEAVE_UNPAID },
    });
    expect(voided.status).toBe(LedgerEntryStatus.VOIDED);
    expect((await entryOf(w.augPeriodId, w.monthlyId)).finalPayable).toBe(27500); // draft refreshed by the reset itself
    const resetRow = await prisma.staffAttendance.findUniqueOrThrow({ where: { userId_date: { userId: w.monthlyId, date: d('2026-08-04') } } });
    expect(resetRow.leaveLedgerEntryId).toBeNull();
    await entries.generateDraft(w.admin, w.augPeriodId);
    monthly = await entryOf(w.augPeriodId, w.monthlyId);
    expect(monthly.finalPayable).toBe(27500);
    expect((await entries.getBreakdown(w.admin, monthly.id)).attendance.pendingDecisionDays).toBe(1);

    // ...and decide it again as unpaid at a different rate: the dead pointer is replaced cleanly.
    await attendance.resolveAbsenceDecisions(w.admin, { userId: w.monthlyId, dates: ['2026-08-04'], action: AbsenceDecisionAction.UNPAID, dailyRate: 800 });
    await entries.generateDraft(w.admin, w.augPeriodId);
    monthly = await entryOf(w.augPeriodId, w.monthlyId);
    expect(monthly.finalPayable).toBe(26700);

    // The DAILY employee: no decision exists (already unpaid by construction) - approve goes straight through,
    // and a decision attempt is simply not offered by the breakdown.
    const daily = await entryOf(w.augPeriodId, w.dailyId);
    expect(daily.baseSalary).toBe(1000); // 1 PRESENT day x 1,000 - the absences were never paid
    expect((await entries.getBreakdown(w.admin, daily.id)).attendance.decisionsApply).toBe(false);
    await entries.approveEntry(w.admin, daily.id, daily.version);

    // Everything decided -> approve works without acknowledgement; lock freezes it.
    monthly = await entryOf(w.augPeriodId, w.monthlyId);
    await entries.approveEntry(w.admin, monthly.id, monthly.version);
    await periods.lockPeriod(w.admin, w.augPeriodId);
    expect((await entryOf(w.augPeriodId, w.monthlyId)).finalPayable).toBe(26700);

    // Locked: a decision on a day inside the locked entry is refused and changes nothing.
    await expect(
      attendance.resolveAbsenceDecisions(w.admin, { userId: w.monthlyId, dates: ['2026-08-06'], action: AbsenceDecisionAction.RESET }),
    ).rejects.toThrow(/locked into a payroll entry/);
    const stillWaived = await prisma.staffAttendance.findUniqueOrThrow({ where: { userId_date: { userId: w.monthlyId, date: d('2026-08-06') } } });
    expect(stillWaived.deductionWaivedAt).not.toBeNull();
  });

  it('approves with acknowledgement even while days are undecided, and pays them in full', async () => {
    const w2 = await makeWorld('abs-ack');
    await mark(w2, w2.monthlyId, '2026-08-03', AttendanceStatus.ABSENT);
    await entries.generateDraft(w2.admin, w2.augPeriodId);
    const entry = await entryOf(w2.augPeriodId, w2.monthlyId);
    const approved = await entries.approveEntry(w2.admin, entry.id, entry.version, true);
    expect(approved.status).toBe(PayrollEntryStatus.APPROVED);
    expect(approved.finalPayable).toBe(30000);
  });

  it('rolls the WHOLE batch back when one day is invalid - no ledger rows, no attendance change', async () => {
    const w3 = await makeWorld('abs-atomic');
    await mark(w3, w3.monthlyId, '2026-08-03', AttendanceStatus.ABSENT);
    await mark(w3, w3.monthlyId, '2026-08-04', AttendanceStatus.PRESENT);
    await expect(
      attendance.resolveAbsenceDecisions(w3.admin, {
        userId: w3.monthlyId,
        dates: ['2026-08-03', '2026-08-04'],
        action: AbsenceDecisionAction.UNPAID,
        dailyRate: 1000,
      }),
    ).rejects.toThrow(/Nothing was changed/);
    expect(await prisma.staffLedgerEntry.count({ where: { vendorId: w3.vendorId } })).toBe(0);
    const row = await prisma.staffAttendance.findUniqueOrThrow({ where: { userId_date: { userId: w3.monthlyId, date: d('2026-08-03') } } });
    expect(row.leaveLedgerEntryId).toBeNull();
  });

  it('refuses another vendor\'s employee (tenancy)', async () => {
    const a = await makeWorld('abs-tenant-a');
    const b = await makeWorld('abs-tenant-b');
    await mark(b, b.monthlyId, '2026-08-03', AttendanceStatus.ABSENT);
    await expect(
      attendance.resolveAbsenceDecisions(a.admin, { userId: b.monthlyId, dates: ['2026-08-03'], action: AbsenceDecisionAction.WAIVE }),
    ).rejects.toThrow(/Employee not found/);
  });
});

describe('"deduct next month" deferral (real DB)', () => {
  it('moves a penalty to the next period without touching effectiveDate, survives the Aug lock, and is claimed by Sep', async () => {
    const w = await makeWorld('defer');
    const penalty = await ledger(w, w.monthlyId, StaffLedgerCategory.PENALTY, -3000, '2026-08-12', 'late deliveries');

    await entries.generateDraft(w.admin, w.augPeriodId);
    expect((await entryOf(w.augPeriodId, w.monthlyId)).penalties).toBe(-3000);

    const deferred = await deferral.defer(w.admin, penalty.id, {
      periodId: w.augPeriodId,
      version: penalty.version,
      reason: 'Employee short on cash this month',
    });
    expect(deferred.payrollAttributionDate?.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(deferred.effectiveDate.toISOString()).toBe('2026-08-12T00:00:00.000Z'); // untouched
    expect(deferred.version).toBe(penalty.version + 1);
    // Both drafts were refreshed by the move itself (August stops charging it, September starts):
    expect((await entryOf(w.augPeriodId, w.monthlyId)).penalties).toBe(0);

    // The audit trail says who/why.
    const audits = await prisma.staffLedgerAuditLog.findMany({ where: { ledgerEntryId: penalty.id }, orderBy: { createdAt: 'asc' } });
    expect(audits.at(-1)).toMatchObject({ actorId: w.admin.userId, reason: expect.stringContaining('Employee short on cash') });

    // August no longer charges it; September does - and the breakdown shows it only there.
    await entries.generateDraft(w.admin, w.augPeriodId);
    expect((await entryOf(w.augPeriodId, w.monthlyId)).penalties).toBe(0);
    expect((await entryOf(w.augPeriodId, w.monthlyId)).finalPayable).toBe(30000);
    await entries.generateDraft(w.admin, w.sepPeriodId);
    const sep = await entryOf(w.sepPeriodId, w.monthlyId);
    expect(sep.penalties).toBe(-3000);
    const sepBreakdown = await entries.getBreakdown(w.admin, sep.id);
    expect(sepBreakdown.ledgerEntriesByBucket.penalties.map((e: any) => e.id)).toEqual([penalty.id]);
    const augBreakdown = await entries.getBreakdown(w.admin, (await entryOf(w.augPeriodId, w.monthlyId)).id);
    expect(augBreakdown.ledgerEntriesByBucket.penalties).toHaveLength(0);

    // Lock August: the deferred row must NOT be claimed by it.
    for (const e of await prisma.payrollEntry.findMany({ where: { periodId: w.augPeriodId } })) {
      await entries.approveEntry(w.admin, e.id, e.version, true);
    }
    await periods.lockPeriod(w.admin, w.augPeriodId);
    expect((await prisma.staffLedgerEntry.findUniqueOrThrow({ where: { id: penalty.id } })).payrollEntryId).toBeNull();

    // Can no longer be put back into the (locked) August - it would never be deducted.
    const fresh = await prisma.staffLedgerEntry.findUniqueOrThrow({ where: { id: penalty.id } });
    await expect(deferral.undoDefer(w.admin, penalty.id, { version: fresh.version, reason: 'changed my mind' })).rejects.toThrow(/already locked/);

    // Lock September: it claims the deferred penalty.
    await entries.generateDraft(w.admin, w.sepPeriodId);
    for (const e of await prisma.payrollEntry.findMany({ where: { periodId: w.sepPeriodId } })) {
      await entries.approveEntry(w.admin, e.id, e.version, true);
    }
    await periods.lockPeriod(w.admin, w.sepPeriodId);
    const claimed = await prisma.staffLedgerEntry.findUniqueOrThrow({ where: { id: penalty.id } });
    expect(claimed.payrollEntryId).toBe((await entryOf(w.sepPeriodId, w.monthlyId)).id);
    expect((await entryOf(w.sepPeriodId, w.monthlyId)).finalPayable).toBe(30000 - 3000 + (await entryOf(w.sepPeriodId, w.monthlyId)).carryForwardIn);
  });

  it('undo puts it back while the original period is still open', async () => {
    const w = await makeWorld('defer-undo');
    const advance = await ledger(w, w.monthlyId, StaffLedgerCategory.ADVANCE, -5000, '2026-08-20', 'cash advance');
    const deferred = await deferral.defer(w.admin, advance.id, { periodId: w.augPeriodId, version: advance.version, reason: 'pay it next month' });
    await entries.generateDraft(w.admin, w.augPeriodId);
    expect((await entryOf(w.augPeriodId, w.monthlyId)).advances).toBe(0);

    await deferral.undoDefer(w.admin, advance.id, { version: deferred.version, reason: 'changed my mind' });
    await entries.generateDraft(w.admin, w.augPeriodId);
    expect((await entryOf(w.augPeriodId, w.monthlyId)).advances).toBe(-5000);
    expect((await prisma.staffLedgerEntry.findUniqueOrThrow({ where: { id: advance.id } })).payrollAttributionDate).toBeNull();
  });

  it('uses the next CASH cycle for a category on the separate cash-deduction window (Oct 1 would still be in September\'s own cycle)', async () => {
    const w = await makeWorld('defer-cash');
    await prisma.payrollVendorConfig.update({
      where: { vendorId: w.vendorId },
      data: { cashCutoffDay: 10, cashWindowCategories: [StaffLedgerCategory.ADVANCE] },
    });
    // September's cash window = cycle containing Sep 30 = Sep 10 .. Oct 9. An advance on Sep 15 belongs to it.
    const advance = await ledger(w, w.monthlyId, StaffLedgerCategory.ADVANCE, -4000, '2026-09-15', 'advance');
    await entries.generateDraft(w.admin, w.sepPeriodId);
    expect((await entryOf(w.sepPeriodId, w.monthlyId)).advances).toBe(-4000);

    const deferred = await deferral.defer(w.admin, advance.id, { periodId: w.sepPeriodId, version: advance.version, reason: 'next month please' });
    expect(deferred.payrollAttributionDate?.toISOString()).toBe('2026-10-10T00:00:00.000Z');
    await entries.generateDraft(w.admin, w.sepPeriodId);
    expect((await entryOf(w.sepPeriodId, w.monthlyId)).advances).toBe(0);
  });

  it('refuses entries it must not move (credits, voided, wrong period) and leaves them untouched', async () => {
    const w = await makeWorld('defer-refuse');
    const bonus = await ledger(w, w.monthlyId, StaffLedgerCategory.BONUS, 2000, '2026-08-12');
    await expect(deferral.defer(w.admin, bonus.id, { periodId: w.augPeriodId, version: bonus.version, reason: 'not a deduction' })).rejects.toThrow(/deduction/);

    const penalty = await ledger(w, w.monthlyId, StaffLedgerCategory.PENALTY, -1000, '2026-08-12');
    // Looking at September, but the penalty belongs to August -> not part of that period.
    await expect(deferral.defer(w.admin, penalty.id, { periodId: w.sepPeriodId, version: penalty.version, reason: 'wrong period' })).rejects.toThrow(/not part of the selected period/);
    // Stale version.
    await expect(deferral.defer(w.admin, penalty.id, { periodId: w.augPeriodId, version: penalty.version + 5, reason: 'stale' })).rejects.toThrow(/Version mismatch/);
    expect((await prisma.staffLedgerEntry.findUniqueOrThrow({ where: { id: penalty.id } })).payrollAttributionDate).toBeNull();
  });
});

describe('max-deduction ceiling (real DB)', () => {
  it('50,000-style scenario: a ceiling charges up to the limit, carries the rest, and drains over periods - nothing lost', async () => {
    const w = await makeWorld('ceiling');
    await setConfig(w, 50); // 50% of 30,000 = 15,000 per period
    await ledger(w, w.monthlyId, StaffLedgerCategory.ADVANCE, -40000, '2026-08-10', 'big advance');

    // August: owed 40,000, ceiling 15,000 -> charge 15,000, hold back 25,000.
    await entries.generateDraft(w.admin, w.augPeriodId);
    const aug = await entryOf(w.augPeriodId, w.monthlyId);
    expect(aug).toMatchObject({ advances: -40000, deferredIn: 0, deferredOut: 25000, finalPayable: 15000 });

    // September: carry-forward is last month's unpaid payable (15,000, nothing settled); held-back 25,000 comes in
    // through the SAME ceiling: charge 15,000 (min(25,000, 15,000)), hold back 10,000.
    await entries.generateDraft(w.admin, w.sepPeriodId);
    let sep = await entryOf(w.sepPeriodId, w.monthlyId);
    expect(sep).toMatchObject({ carryForwardIn: 15000, deferredIn: 25000, deferredOut: 10000, finalPayable: 30000 + 15000 - 15000 });

    // Turn the ceiling off: the whole 25,000 backlog is charged at once - never stranded.
    await setConfig(w, null);
    await entries.generateDraft(w.admin, w.sepPeriodId);
    sep = await entryOf(w.sepPeriodId, w.monthlyId);
    expect(sep).toMatchObject({ deferredIn: 25000, deferredOut: 0, finalPayable: 30000 + 15000 - 25000 });

    // Conservation: across both months the employee is charged exactly the 40,000 that was posted.
    // Aug charged 15,000 + Sep charged 25,000.
    expect(40000 - aug.deferredOut).toBe(15000);
    expect(aug.deferredOut).toBe(sep.deferredIn);
  });

  it('is a strict no-op while the ceiling is off, even for a deduction bigger than the salary (negative payable carries as before)', async () => {
    const w = await makeWorld('ceiling-off');
    await ledger(w, w.monthlyId, StaffLedgerCategory.ADVANCE, -45000, '2026-08-10', 'bigger than salary');
    await entries.generateDraft(w.admin, w.augPeriodId);
    const aug = await entryOf(w.augPeriodId, w.monthlyId);
    expect(aug).toMatchObject({ deferredIn: 0, deferredOut: 0, finalPayable: -15000 });
    await entries.generateDraft(w.admin, w.sepPeriodId);
    expect((await entryOf(w.sepPeriodId, w.monthlyId)).carryForwardIn).toBe(-15000);
  });

  it('lock recomputes the same ceiling numbers it showed in the draft, and freezes deferredOut into the snapshot', async () => {
    const w = await makeWorld('ceiling-lock');
    await setConfig(w, 50);
    await ledger(w, w.monthlyId, StaffLedgerCategory.PENALTY, -20000, '2026-08-10');
    await entries.generateDraft(w.admin, w.augPeriodId);
    for (const e of await prisma.payrollEntry.findMany({ where: { periodId: w.augPeriodId } })) {
      await entries.approveEntry(w.admin, e.id, e.version, true);
    }
    await periods.lockPeriod(w.admin, w.augPeriodId);
    const locked = await entryOf(w.augPeriodId, w.monthlyId);
    expect(locked).toMatchObject({ status: PayrollEntryStatus.LOCKED, penalties: -20000, deferredOut: 5000, finalPayable: 15000 });
    const snapshot = await prisma.payrollSnapshot.findFirstOrThrow({ where: { payrollEntryId: locked.id } });
    expect(snapshot.breakdownJson).toMatchObject({ deferredIn: 0, deferredOut: 5000, finalPayable: 15000 });
  });
});

// Keep PayrollPeriodStatus referenced: the period rows above are created OPEN (the default).
void PayrollPeriodStatus;
