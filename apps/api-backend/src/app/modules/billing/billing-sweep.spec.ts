import { Prisma } from '@prisma/client';
import { BillingSweepService, billingOptionsFromEnv } from './billing-sweep.service';

const D = (v: number) => new Prisma.Decimal(v);
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const OPTS_OFF = { autoSuspend: false, graceDays: 7, renewalLeadDays: 7 };
const OPTS_ON = { ...OPTS_OFF, autoSuspend: true };

type Sub = {
  id: string; vendorId: string; status: string; trialEndsAt: Date | null; currentPeriodEnd: Date;
  pastDueSince: Date | null; suspendedByBilling: boolean; vendorActive: boolean;
  plan: { price: Prisma.Decimal; currency: string; interval: string; name: string };
};

const mk = (over: Partial<Sub> & { id: string }): Sub => ({
  vendorId: `v-${over.id}`, status: 'ACTIVE', trialEndsAt: null, currentPeriodEnd: day('2027-06-01'),
  pastDueSince: null, suspendedByBilling: false, vendorActive: true,
  plan: { price: D(1000), currency: 'PKR', interval: 'MONTHLY', name: 'Starter' },
  ...over,
});

/** Tiny in-memory model of the few queries the sweep issues. */
function setup(subs: Sub[], paidInvoices: { subscriptionId: string; periodEnd: Date }[] = []) {
  const created: any[] = [];
  const prisma = {
    vendorSubscription: {
      findMany: jest.fn(async ({ where, include }: any) => {
        let r = subs.filter((s) => s.status === where.status);
        if (where.trialEndsAt?.lt) r = r.filter((s) => s.trialEndsAt && s.trialEndsAt < where.trialEndsAt.lt);
        if (where.currentPeriodEnd?.lt) r = r.filter((s) => s.currentPeriodEnd < where.currentPeriodEnd.lt);
        if (where.currentPeriodEnd?.lte) r = r.filter((s) => s.currentPeriodEnd <= where.currentPeriodEnd.lte);
        if (where.pastDueSince?.lte) r = r.filter((s) => s.pastDueSince && s.pastDueSince <= where.pastDueSince.lte);
        if (where.suspendedByBilling === false) r = r.filter((s) => !s.suspendedByBilling);
        if (where.vendor?.isActive) r = r.filter((s) => s.vendorActive);
        return r.map((s) => (include ? s : { id: s.id, vendorId: s.vendorId }));
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const s = subs.find((x) => x.id === where.id && x.status === where.status);
        if (!s) return { count: 0 };
        Object.assign(s, data);
        return { count: 1 };
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const s = subs.find((x) => x.id === where.id)!;
        if (data.currentPeriodEnd) s.currentPeriodEnd = data.currentPeriodEnd;
        if (data.suspendedByBilling !== undefined) s.suspendedByBilling = data.suspendedByBilling;
        return s;
      }),
    },
    invoice: {
      findFirst: jest.fn(async ({ where }: any) =>
        paidInvoices.find((i) => i.subscriptionId === where.subscriptionId && i.periodEnd >= where.periodEnd.gte) ?? null,
      ),
    },
  };
  const audit = { log: jest.fn() };
  const vendors = {
    suspend: jest.fn(async (vendorId: string) => {
      const s = subs.find((x) => x.vendorId === vendorId)!;
      s.vendorActive = false;
    }),
  };
  const invoices = {
    createRenewalInvoice: jest.fn(async (s: Sub) => {
      const key = `${s.id}|${s.currentPeriodEnd.toISOString()}`;
      if (created.includes(key)) return null; // unique violation swallowed
      created.push(key);
      return { id: key };
    }),
  };
  const planLimits = { invalidate: jest.fn() };
  const svc = new BillingSweepService(prisma as never, audit as never, vendors as never, invoices as never, planLimits as never);
  return { svc, subs, audit, vendors, invoices, planLimits };
}

describe('billing sweep', () => {
  it('expired TRIAL -> PAST_DUE with pastDueSince', async () => {
    const now = day('2026-11-12');
    const { svc, subs, audit } = setup([mk({ id: 'a', status: 'TRIAL', trialEndsAt: day('2026-11-10'), currentPeriodEnd: day('2026-11-10') })]);
    const res = await svc.runBillingSweep(now, OPTS_OFF);
    expect(res.trialsExpired).toBe(1);
    expect(subs[0]).toMatchObject({ status: 'PAST_DUE', pastDueSince: now });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'SUBSCRIPTION_PAST_DUE', userName: 'system' }));
  });

  it('unexpired TRIAL is untouched', async () => {
    const { svc, subs } = setup([mk({ id: 'a', status: 'TRIAL', trialEndsAt: day('2026-11-20'), currentPeriodEnd: day('2026-11-20') })]);
    await svc.runBillingSweep(day('2026-11-12'), OPTS_OFF);
    expect(subs[0].status).toBe('TRIAL');
  });

  it('ACTIVE with a lapsed period and no covering paid invoice -> PAST_DUE', async () => {
    const { svc, subs } = setup([mk({ id: 'a', currentPeriodEnd: day('2026-11-01') })]);
    const res = await svc.runBillingSweep(day('2026-11-12'), OPTS_OFF);
    expect(res.periodsLapsed).toBe(1);
    expect(subs[0].status).toBe('PAST_DUE');
  });

  it('ACTIVE lapsed but covered by a PAID invoice is not moved', async () => {
    const { svc, subs } = setup(
      [mk({ id: 'a', currentPeriodEnd: day('2026-11-01') })],
      [{ subscriptionId: 'a', periodEnd: day('2026-12-01') }],
    );
    await svc.runBillingSweep(day('2026-11-12'), OPTS_OFF);
    expect(subs[0].status).toBe('ACTIVE');
  });

  it('a free plan rolls forward instead of going past due', async () => {
    const { svc, subs } = setup([
      mk({ id: 'a', currentPeriodEnd: day('2026-09-01'), plan: { price: D(0), currency: 'PKR', interval: 'MONTHLY', name: 'Free' } }),
    ]);
    const res = await svc.runBillingSweep(day('2026-11-12'), OPTS_OFF);
    expect(res.freeRolledForward).toBe(1);
    expect(subs[0].status).toBe('ACTIVE');
    expect(subs[0].currentPeriodEnd > day('2026-11-12')).toBe(true);
  });

  describe('auto-suspend', () => {
    const pastDue = (since: string, over: Partial<Sub> = {}) =>
      mk({ id: 'a', status: 'PAST_DUE', currentPeriodEnd: day('2026-10-01'), pastDueSince: day(since), ...over });

    it('flag ON: day 6 not suspended, day 8 suspended', async () => {
      const day6 = setup([pastDue('2026-11-06')]);
      await day6.svc.runBillingSweep(day('2026-11-12'), OPTS_ON);
      expect(day6.vendors.suspend).not.toHaveBeenCalled();

      const day8 = setup([pastDue('2026-11-04')]);
      const res = await day8.svc.runBillingSweep(day('2026-11-12'), OPTS_ON);
      expect(res.suspended).toBe(1);
      expect(day8.vendors.suspend).toHaveBeenCalledWith('v-a');
      expect(day8.subs[0].suspendedByBilling).toBe(true);
      expect(day8.audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'BILLING_AUTO_SUSPEND' }));
    });

    it('flag OFF never suspends', async () => {
      const { svc, vendors } = setup([pastDue('2026-01-01')]);
      await svc.runBillingSweep(day('2026-11-12'), OPTS_OFF);
      expect(vendors.suspend).not.toHaveBeenCalled();
    });

    it('a manually suspended vendor is untouched', async () => {
      const { svc, vendors, subs } = setup([pastDue('2026-01-01', { vendorActive: false })]);
      await svc.runBillingSweep(day('2026-11-12'), OPTS_ON);
      expect(vendors.suspend).not.toHaveBeenCalled();
      expect(subs[0].suspendedByBilling).toBe(false);
    });
  });

  it('renewal invoices are created once (second run is a no-op)', async () => {
    const { svc, invoices } = setup([mk({ id: 'a', currentPeriodEnd: day('2026-11-15') })]);
    const first = await svc.runBillingSweep(day('2026-11-12'), OPTS_OFF);
    const second = await svc.runBillingSweep(day('2026-11-12'), OPTS_OFF);
    expect(first.renewalInvoices).toBe(1);
    expect(second.renewalInvoices).toBe(0);
    expect(invoices.createRenewalInvoice).toHaveBeenCalledTimes(2);
  });

  it('a second full run changes nothing', async () => {
    const now = day('2026-11-12');
    const { svc, subs } = setup([
      mk({ id: 't', status: 'TRIAL', trialEndsAt: day('2026-11-01'), currentPeriodEnd: day('2026-11-01') }),
      mk({ id: 'l', currentPeriodEnd: day('2026-11-01') }),
    ]);
    await svc.runBillingSweep(now, OPTS_OFF);
    const snapshot = JSON.stringify(subs);
    const again = await svc.runBillingSweep(now, OPTS_OFF);
    expect(again).toMatchObject({ trialsExpired: 0, periodsLapsed: 0, suspended: 0 });
    expect(JSON.stringify(subs)).toBe(snapshot);
  });

  it('invalidates the limits cache for touched vendors', async () => {
    const { svc, planLimits } = setup([mk({ id: 'a', currentPeriodEnd: day('2026-11-01') })]);
    await svc.runBillingSweep(day('2026-11-12'), OPTS_OFF);
    expect(planLimits.invalidate).toHaveBeenCalledWith('v-a');
  });
});

describe('billingOptionsFromEnv', () => {
  it('defaults: auto-suspend OFF, 7 grace days', () => {
    expect(billingOptionsFromEnv({} as never)).toMatchObject({ autoSuspend: false, graceDays: 7 });
  });
  it('reads the flags', () => {
    expect(billingOptionsFromEnv({ BILLING_AUTO_SUSPEND: 'true', BILLING_GRACE_DAYS: '3' } as never)).toMatchObject({
      autoSuspend: true,
      graceDays: 3,
    });
  });
});
