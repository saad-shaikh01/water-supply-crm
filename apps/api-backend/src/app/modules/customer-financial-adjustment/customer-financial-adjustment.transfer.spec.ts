import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '@water-supply-crm/types';
import { CustomerFinancialAdjustmentService } from './customer-financial-adjustment.service';
import { CustomerFinancialAdjustmentTransferService } from './customer-financial-adjustment-transfer.service';

const VENDOR_ID = 'vendor-1';
const OTHER_VENDOR_ID = 'vendor-2';
// Ids are ordered on purpose: A < B < I < X drives the sorted-lock-order assertions.
const A = 'cust-a'; // active, owes 1000
const B = 'cust-b'; // active, owes 200
const I = 'cust-i'; // INACTIVE, owes 300
const X = 'cust-x'; // belongs to ANOTHER vendor
const USER: AuthUser = {
  userId: 'user-1',
  email: 'accountant@example.com',
  name: 'Bilal Accountant',
  role: 'STAFF',
  vendorId: VENDOR_ID,
  customerId: null,
};
const P = (a: string) => `customer_financial_adjustments:${a}`;
const ALL = [P('transfer'), P('void'), P('view')];
const round2 = (n: number) => Math.round(n * 100) / 100;
const REASON = 'Transferred to the wrong account';
const NOW = new Date('2026-09-20T09:00:00.000Z');
const LATER = new Date('2026-09-20T15:30:00.000Z');

type Outcome = 'commit' | 'rollback';

/**
 * STATEFUL in-memory ledger for TWO customers' worth of transfers. Same conventions as the
 * void spec's harness (per-transaction undo logs, atomic updateMany like a row-locked UPDATE,
 * writes on the plain client land in `s.outside`), plus what transfers need:
 *   - several customers with real filters (`financialBalance: { gte }`, `isActive`, `vendorId`);
 *   - Postgres-faithful unique keys: a second transaction inserting a key an UNCOMMITTED
 *     transaction holds WAITS for its outcome — commit → P2002, rollback → proceeds — and an
 *     uncommitted group is invisible to other readers;
 *   - `s.precheck`: a hook run on the plain client's customer read (after the rows were read,
 *     so the caller keeps a STALE copy) — used to open the race window between the service's
 *     pre-checks and its transaction, deterministically;
 *   - failure injection ONLY inside transactions (`s.failOn`), and `s.tamper` to corrupt a ledger row.
 * Every call yields once, so concurrent transactions genuinely interleave.
 */
function buildWorld() {
  const s = {
    customers: new Map<string, any>(),
    base: new Map<string, number>(),
    groups: new Map<string, any>(),
    pendingGroups: new Map<string, Promise<Outcome>>(),
    adjustments: new Map<string, any>(),
    transactions: new Map<string, any>(),
    audit: [] as any[],
    committed: [] as string[],
    outside: [] as string[],
    calls: [] as { op: string; args: any; tx: number | null }[],
    failOn: null as string | null,
    precheck: null as null | (() => Promise<void> | void),
    tamper: 0,
    pendingItems: {} as Record<string, number>,
    wallets: [] as { customerId: string; balance: number; product: { name: string } }[],
    seq: 0,
    txSeq: 0,
  };
  const nextId = (p: string) => `${p}-${++s.seq}`;
  const tick = () => Promise.resolve();
  const p2002 = () =>
    new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' });

  const addCustomer = (id: string, o: { vendorId?: string; code: string; name: string; balance: number; isActive?: boolean }) => {
    s.customers.set(id, {
      id,
      vendorId: o.vendorId ?? VENDOR_ID,
      customerCode: o.code,
      name: o.name,
      isActive: o.isActive ?? true,
      financialBalance: o.balance,
    });
    s.base.set(id, o.balance);
  };
  addCustomer(A, { code: 'C-A', name: 'Ahmed Khan', balance: 1000 });
  addCustomer(B, { code: 'C-B', name: 'Bilal Traders', balance: 200 });
  addCustomer(I, { code: 'C-I', name: 'Imran Closed', balance: 300, isActive: false });
  addCustomer(X, { vendorId: OTHER_VENDOR_ID, code: 'C-X', name: 'Other Vendor Customer', balance: 500 });

  const matchVal = (v: any, cond: any): boolean => {
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('gte' in cond) return v >= cond.gte;
      if ('in' in cond) return cond.in.includes(v);
      if ('not' in cond) return v !== cond.not;
    }
    return v === cond;
  };
  const matches = (d: any, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => matchVal(d[k], v));

  const client = (undo: (() => void)[] | null, writes: string[] | null, tx: { id: number; done: Promise<Outcome> } | null) => {
    const counts: Record<string, number> = {};
    const track = async (op: string, args: unknown) => {
      await tick(); // every call yields → concurrent transactions interleave
      s.calls.push({ op, args, tx: tx?.id ?? null });
      counts[op] = (counts[op] ?? 0) + 1;
      // Failures are injected only inside a transaction — the point is atomicity.
      if (tx && ((s.failOn === op && counts[op] === 1) || s.failOn === `${op}#${counts[op]}`)) {
        throw new Error(`injected failure: ${op}`);
      }
    };
    const wrote = (op: string) => (writes ? writes.push(op) : s.outside.push(op));
    const withTxn = (d: any) => {
      const t = [...s.transactions.values()].find((x) => x.adjustmentId === d.id);
      return { ...structuredClone(d), transaction: t ? structuredClone(t) : null };
    };
    const applyBalance = (c: any, data: any) => {
      const f = data.financialBalance;
      const delta: number = f.increment !== undefined ? f.increment : -f.decrement;
      c.financialBalance += delta; // raw float arithmetic, exactly as the database does
      undo?.push(() => {
        c.financialBalance -= delta;
      });
    };

    return {
      customer: {
        findMany: async (args: any) => {
          await track('customer.findMany', args);
          const rows = [...s.customers.values()].filter((c) => matches(c, args.where)).map((c) => structuredClone(c));
          if (!tx && s.precheck) await s.precheck(); // rows above are now STALE for the caller
          return rows;
        },
        updateMany: async (args: any) => {
          await track('customer.updateMany', args);
          let count = 0;
          for (const c of s.customers.values()) {
            if (!matches(c, args.where)) continue;
            applyBalance(c, args.data);
            count++;
          }
          if (count) wrote('customer.updateMany');
          return { count };
        },
        update: async (args: any) => {
          await track('customer.update', args);
          const c = s.customers.get(args.where.id);
          if (!c) throw new Error('customer not found');
          applyBalance(c, args.data);
          wrote('customer.update');
          return { financialBalance: c.financialBalance };
        },
      },
      customerFinancialAdjustmentGroup: {
        findFirst: async (args: any) => {
          await track('group.findFirst', args);
          const g = [...s.groups.values()].find((x) => !s.pendingGroups.has(x.id) && matches(x, args.where));
          if (!g) return null;
          const out = structuredClone(g);
          if (args.include?.adjustments) {
            out.adjustments = [...s.adjustments.values()].filter((a) => a.groupId === g.id).map(withTxn);
          }
          return out;
        },
        findUniqueOrThrow: async (args: any) => {
          await track('group.findUniqueOrThrow', args);
          const g = s.groups.get(args.where.id);
          if (!g) throw new Error('not found');
          return structuredClone(g);
        },
        create: async (args: any) => {
          await track('group.create', args);
          const d = {
            id: nextId('grp'),
            status: 'POSTED',
            idempotencyKey: null,
            voidedById: null,
            voidedAt: null,
            voidReason: null,
            ...args.data,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          // Postgres unique semantics: a key held by an UNCOMMITTED other transaction makes us wait.
          const holder = [...s.groups.values()].find(
            (g) => d.idempotencyKey && g.vendorId === d.vendorId && g.idempotencyKey === d.idempotencyKey,
          );
          if (holder) {
            const pending = s.pendingGroups.get(holder.id);
            if (pending && pending !== tx?.done) {
              if ((await pending) === 'commit') throw p2002();
            } else {
              throw p2002();
            }
          }
          s.groups.set(d.id, d);
          if (tx) s.pendingGroups.set(d.id, tx.done);
          wrote('group.create');
          undo?.push(() => {
            s.groups.delete(d.id);
            s.pendingGroups.delete(d.id);
          });
          return structuredClone(d);
        },
        updateMany: async (args: any) => {
          await track('group.updateMany', args);
          let count = 0;
          for (const g of s.groups.values()) {
            if (!matches(g, args.where)) continue;
            const prev = { ...g };
            Object.assign(g, args.data);
            undo?.push(() => Object.assign(g, prev));
            count++;
          }
          if (count) wrote('group.updateMany');
          return { count };
        },
      },
      customerFinancialAdjustment: {
        // Used only by the EXISTING single-adjustment service (single-leg void refusal).
        findFirst: async (args: any) => {
          await track('adjustment.findFirst', args);
          const d = [...s.adjustments.values()].find((x) => matches(x, args.where));
          return d ? withTxn(d) : null;
        },
        findUniqueOrThrow: async (args: any) => {
          await track('adjustment.findUniqueOrThrow', args);
          const d = s.adjustments.get(args.where.id);
          if (!d) throw new Error('not found');
          return structuredClone(d);
        },
        create: async (args: any) => {
          await track('adjustment.create', args);
          const d = {
            id: nextId('adj'),
            status: 'POSTED',
            groupId: null,
            reversalOfId: null,
            counterpartyCustomerId: null,
            internalNote: null,
            referenceNo: null,
            voidedById: null,
            voidedAt: null,
            voidReason: null,
            idempotencyKey: null,
            ...args.data,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          if (d.reversalOfId && [...s.adjustments.values()].some((x) => x.reversalOfId === d.reversalOfId)) throw p2002();
          s.adjustments.set(d.id, d);
          wrote('adjustment.create');
          undo?.push(() => s.adjustments.delete(d.id));
          return structuredClone(d);
        },
        updateMany: async (args: any) => {
          await track('adjustment.updateMany', args);
          let count = 0;
          for (const d of s.adjustments.values()) {
            if (!matches(d, args.where)) continue;
            const prev = { ...d };
            Object.assign(d, args.data);
            undo?.push(() => Object.assign(d, prev));
            count++;
          }
          if (count) wrote('adjustment.updateMany');
          return { count };
        },
      },
      transaction: {
        create: async (args: any) => {
          await track('transaction.create', args);
          const amount = args.data.amount + (args.data.amount > 0 ? s.tamper : 0);
          const t = { id: nextId('txn'), ...args.data, amount, createdAt: args.data.createdAt ?? new Date() };
          s.transactions.set(t.id, t);
          wrote('transaction.create');
          undo?.push(() => s.transactions.delete(t.id));
          return structuredClone(t);
        },
      },
      auditLog: {
        create: async (args: any) => {
          await track('auditLog.create', args);
          const a = { id: nextId('audit'), ...args.data };
          s.audit.push(a);
          wrote('auditLog.create');
          undo?.push(() => {
            s.audit.splice(s.audit.indexOf(a), 1);
          });
          return structuredClone(a);
        },
      },
      dailySheetItem: {
        count: async (args: any) => {
          await track('dailySheetItem.count', args);
          return s.pendingItems[args.where.customerId] ?? 0;
        },
      },
      bottleWallet: {
        findMany: async (args: any) => {
          await track('bottleWallet.findMany', args);
          return s.wallets.filter((w) => w.customerId === args.where.customerId && w.balance !== 0).map((w) => structuredClone(w));
        },
      },
    };
  };

  const db: any = client(null, null, null);
  db.$transaction = jest.fn(async (fn: (tx: any) => Promise<unknown>) => {
    const undo: (() => void)[] = [];
    const writes: string[] = [];
    let resolve!: (o: Outcome) => void;
    const done = new Promise<Outcome>((r) => (resolve = r));
    const state = { id: ++s.txSeq, done };
    try {
      const result = await fn(client(undo, writes, state));
      for (const [id, d] of s.pendingGroups) if (d === done) s.pendingGroups.delete(id);
      s.committed.push(...writes);
      resolve('commit');
      return result;
    } catch (e) {
      for (const u of undo.reverse()) u();
      resolve('rollback');
      throw e;
    }
  });

  const bal = (id: string) => round2(s.customers.get(id).financialBalance);
  const total = () => [...s.customers.values()].reduce((n, c) => n + c.financialBalance, 0);
  /** cached balance == opening + Σ that customer's ledger rows (the ledger-first invariant). */
  const consistent = (id: string) => {
    const sum = [...s.transactions.values()].filter((t) => t.customerId === id).reduce((n, t) => n + t.amount, 0);
    return round2(s.base.get(id)! + sum) === bal(id);
  };
  const snapshot = () => ({
    customers: structuredClone([...s.customers.values()]),
    groups: structuredClone([...s.groups.values()]),
    adjustments: structuredClone([...s.adjustments.values()]),
    transactions: structuredClone([...s.transactions.values()]),
    audit: structuredClone(s.audit),
  });

  return { s, db, bal, total, consistent, snapshot };
}

function build(granted: string[] = ALL) {
  const world = buildWorld();
  const cache = {
    invalidateVendorEntity: jest.fn().mockResolvedValue(undefined),
    invalidateOverview: jest.fn().mockResolvedValue(undefined),
    invalidateAnalytics: jest.fn().mockResolvedValue(undefined),
    invalidateCustomerWallets: jest.fn().mockResolvedValue(undefined),
  };
  const permissions = { can: jest.fn(async (_u: string, perm: string) => granted.includes(perm)) };
  const service = new CustomerFinancialAdjustmentTransferService(world.db, cache as any, permissions as any);
  // The EXISTING single-adjustment service, over the same world — to prove it still refuses a lone leg.
  const single = new CustomerFinancialAdjustmentService(world.db, cache as any, permissions as any);
  return { service, single, cache, permissions, ...world };
}

const barrier = (n: number) => {
  let arrived = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  return async () => {
    if (++arrived >= n) release();
    await gate;
  };
};

let keySeq = 0;
const dto = (o: Record<string, unknown> = {}) =>
  ({ fromCustomerId: A, toCustomerId: B, amount: 300, idempotencyKey: `transfer-key-${++keySeq}`, ...o }) as any;
const voidDto = (reason = REASON) => ({ reason }) as any;

describe('CustomerFinancialAdjustmentTransferService', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout'] }).setSystemTime(NOW);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  // ══ create ══════════════════════════════════════════════════════════════════

  describe('create: the transfer invariants', () => {
    it('SOURCE decreases and TARGET increases by exactly the amount; receivables are conserved', async () => {
      const w = build();
      const before = w.total();
      const r = await w.service.create(USER, dto({ amount: 300 }));

      expect(w.bal(A)).toBe(700);
      expect(w.bal(B)).toBe(500);
      expect(r.sourceBalance).toBe(700);
      expect(r.targetBalance).toBe(500);
      expect(w.total()).toBe(before); // nothing created, nothing destroyed
      expect(r.idempotentReplay).toBe(false);
    });

    it('BOTH legs are linked: one group, cross-referencing counterparties, one ledger row each', async () => {
      const w = build();
      const r = await w.service.create(USER, dto({ amount: 300 }));

      expect(r.group).toMatchObject({ type: 'TRANSFER', status: 'POSTED', vendorId: VENDOR_ID, createdById: USER.userId });
      expect(w.s.groups.size).toBe(1);
      const legs = [...w.s.adjustments.values()].filter((a) => a.groupId === r.group.id);
      expect(legs).toHaveLength(2);
      expect(w.s.adjustments.size).toBe(2); // nothing else was created

      expect(r.sourceLeg.adjustment).toMatchObject({
        kind: 'TRANSFER_OUT',
        direction: 'CREDIT',
        customerId: A,
        counterpartyCustomerId: B,
        groupId: r.group.id,
        amount: 300,
        status: 'POSTED',
        customerVisibility: 'ITEMIZED',
        vendorId: VENDOR_ID,
      });
      expect(r.targetLeg.adjustment).toMatchObject({
        kind: 'TRANSFER_IN',
        direction: 'CHARGE',
        customerId: B,
        counterpartyCustomerId: A,
        groupId: r.group.id,
        amount: 300,
        status: 'POSTED',
        customerVisibility: 'ITEMIZED',
        vendorId: VENDOR_ID,
      });
      // one ledger row per leg, linked by adjustmentId, on the right customer
      expect(r.sourceLeg.transaction).toMatchObject({ adjustmentId: r.sourceLeg.adjustment.id, customerId: A, type: 'ADJUSTMENT' });
      expect(r.targetLeg.transaction).toMatchObject({ adjustmentId: r.targetLeg.adjustment.id, customerId: B, type: 'ADJUSTMENT' });
      expect(w.s.transactions.size).toBe(2);
      expect(new Set([...w.s.transactions.values()].map((t) => t.adjustmentId)).size).toBe(2);
    });

    it('the two ledger rows net to ZERO (−amount on the source, +amount on the target)', async () => {
      const w = build();
      const r = await w.service.create(USER, dto({ amount: 123.45 }));

      expect(r.sourceLeg.transaction.amount).toBe(-123.45);
      expect(r.targetLeg.transaction.amount).toBe(123.45);
      const net = [...w.s.transactions.values()].reduce((n, t) => n + Math.round(t.amount * 100), 0);
      expect(net).toBe(0); // in paise
    });

    it('cached balances stay equal to opening + Σ ledger (ledger-first) for BOTH customers', async () => {
      const w = build();
      await w.service.create(USER, dto({ amount: 123.45 }));
      expect(w.consistent(A)).toBe(true);
      expect(w.consistent(B)).toBe(true);
      expect(w.bal(A)).toBe(876.55);
      expect(w.bal(B)).toBe(323.45);
    });

    it('can transfer the FULL balance (source ends at 0), including float-noise balances', async () => {
      const w = build();
      await w.service.create(USER, dto({ amount: 1000 }));
      expect(w.bal(A)).toBe(0);

      const n = build();
      n.s.customers.get(A).financialBalance = 100.09999999999999; // "100.10" after increments
      await n.service.create(USER, dto({ amount: 100.1 }));
      expect(Math.abs(n.s.customers.get(A).financialBalance)).toBeLessThan(1e-9);
      expect(n.s.transactions.size).toBe(2);
    });

    it('writes customer-safe wording: customer CODES only, no names, no staff note, money-only rows', async () => {
      const w = build();
      const r = await w.service.create(USER, dto({ amount: 300, internalNote: 'secret staff reason', referenceNo: 'REF-9' }));

      expect(r.sourceLeg.transaction.description).toBe('Balance transferred to C-B');
      expect(r.targetLeg.transaction.description).toBe('Balance transferred from C-A');
      for (const t of w.s.transactions.values()) {
        expect(t.description).not.toMatch(/Ahmed|Bilal|Khan|Traders|secret/);
        expect(t).not.toHaveProperty('productId');
        expect(t).not.toHaveProperty('bottleCount');
        expect(t.createdAt).toEqual(NOW); // always dated now
      }
      // the staff-only note lives on the documents, never on the ledger
      expect(r.sourceLeg.adjustment).toMatchObject({ internalNote: 'secret staff reason', referenceNo: 'REF-9', title: 'Balance transferred to C-B' });
      expect(r.targetLeg.adjustment).toMatchObject({ title: 'Balance transferred from C-A', effectiveDate: NOW });
    });

    it('is ONE atomic transaction — every write commits together, none on the plain client', async () => {
      const w = build();
      await w.service.create(USER, dto());
      expect(w.db.$transaction).toHaveBeenCalledTimes(1);
      expect(w.s.outside).toEqual([]);
      expect(w.s.committed.sort()).toEqual(
        [
          'group.create',
          'customer.updateMany',
          'customer.updateMany',
          'adjustment.create',
          'adjustment.create',
          'transaction.create',
          'transaction.create',
          'auditLog.create',
          'auditLog.create',
          'auditLog.create',
        ].sort(),
      );
    });

    it('writes both customers in SORTED-ID order whichever is the source (no A↔B deadlock)', async () => {
      const forward = build();
      await forward.service.create(USER, dto({ fromCustomerId: A, toCustomerId: B, amount: 100 }));
      const reverse = build();
      await reverse.service.create(USER, dto({ fromCustomerId: B, toCustomerId: A, amount: 100 }));

      for (const w of [forward, reverse]) {
        const order = w.s.calls.filter((c) => c.op === 'customer.updateMany').map((c) => c.args.where.id);
        expect(order).toEqual([A, B]);
      }
    });

    it('the source decrement is CONDITIONAL on the balance; the target increment on isActive', async () => {
      const w = build();
      await w.service.create(USER, dto({ amount: 300 }));
      const [srcCall, tgtCall] = w.s.calls.filter((c) => c.op === 'customer.updateMany');
      expect(srcCall.args.where).toMatchObject({ id: A, vendorId: VENDOR_ID });
      expect(srcCall.args.where.financialBalance.gte).toBeCloseTo(300, 2);
      expect(srcCall.args.data).toEqual({ financialBalance: { decrement: 300 } });
      expect(tgtCall.args.where).toEqual({ id: B, vendorId: VENDOR_ID, isActive: true });
      expect(tgtCall.args.data).toEqual({ financialBalance: { increment: 300 } });
    });

    it('audit: the group and each leg, written inside the transaction, with before/after balances', async () => {
      const w = build();
      const r = await w.service.create(USER, dto({ amount: 300, internalNote: 'Customer moved shops' }));

      expect(w.s.audit).toHaveLength(3);
      expect(w.s.audit.every((a) => a.action === 'CREATE' && a.vendorId === VENDOR_ID && a.userId === USER.userId)).toBe(true);
      const group = w.s.audit.find((a) => a.entity === 'CustomerFinancialAdjustmentGroup');
      expect(group.entityId).toBe(r.group.id);
      expect(group.changes.after).toMatchObject({
        type: 'TRANSFER',
        amount: 300,
        fromCustomerId: A,
        toCustomerId: B,
        sourceBalance: { before: 1000, after: 700 },
        targetBalance: { before: 200, after: 500 },
      });
      expect(group.changes.reason).toBe('Customer moved shops');
      const legIds = w.s.audit.filter((a) => a.entity === 'CustomerFinancialAdjustment').map((a) => a.entityId);
      expect(legIds.sort()).toEqual([r.sourceLeg.adjustment.id, r.targetLeg.adjustment.id].sort());
    });

    it('invalidates the caches AFTER commit for BOTH customers; a Redis failure never fails the transfer', async () => {
      const w = build();
      await w.service.create(USER, dto());
      expect(w.cache.invalidateVendorEntity).toHaveBeenCalledTimes(1);
      expect(w.cache.invalidateOverview).toHaveBeenCalledWith(VENDOR_ID);
      expect(w.cache.invalidateAnalytics).toHaveBeenCalledWith(VENDOR_ID);
      expect(w.cache.invalidateCustomerWallets.mock.calls.map((c) => c[1]).sort()).toEqual([A, B]);

      const flaky = build();
      flaky.cache.invalidateOverview.mockRejectedValue(new Error('redis down'));
      await expect(flaky.service.create(USER, dto())).resolves.toMatchObject({ idempotentReplay: false });
      expect(flaky.bal(A)).toBe(700);
    });
  });

  describe('create: same-vendor validation (a foreign id is a 404, never revealed)', () => {
    it('refuses a target in ANOTHER vendor — nothing is written', async () => {
      const w = build();
      const pre = w.snapshot();
      await expect(w.service.create(USER, dto({ toCustomerId: X }))).rejects.toThrow(new NotFoundException('Target customer not found'));
      expect(w.snapshot()).toEqual(pre);
      expect(w.db.$transaction).not.toHaveBeenCalled();
    });

    it('refuses a source in ANOTHER vendor — nothing is written', async () => {
      const w = build();
      const pre = w.snapshot();
      await expect(w.service.create(USER, dto({ fromCustomerId: X }))).rejects.toThrow(new NotFoundException('Source customer not found'));
      expect(w.snapshot()).toEqual(pre);
    });

    it('refuses unknown customers', async () => {
      const w = build();
      await expect(w.service.create(USER, dto({ toCustomerId: 'nope' }))).rejects.toBeInstanceOf(NotFoundException);
      await expect(w.service.create(USER, dto({ fromCustomerId: 'nope' }))).rejects.toBeInstanceOf(NotFoundException);
    });

    it('scopes every customer read AND write to the caller’s vendor', async () => {
      const w = build();
      await w.service.create(USER, dto());
      for (const c of w.s.calls.filter((c) => c.op === 'customer.findMany' || c.op === 'customer.updateMany')) {
        expect(c.args.where.vendorId).toBe(VENDOR_ID);
      }
      const lookup = w.s.calls.find((c) => c.op === 'group.findFirst')!;
      expect(lookup.args.where).toMatchObject({ vendorId: VENDOR_ID }); // idempotency lookup is vendor-scoped
    });

    it('refuses a transfer to the SAME customer before touching the database', async () => {
      const w = build();
      await expect(w.service.create(USER, dto({ fromCustomerId: A, toCustomerId: A }))).rejects.toBeInstanceOf(BadRequestException);
      expect(w.s.calls).toHaveLength(0);
    });
  });

  describe('create: active / inactive customers', () => {
    it('BLOCKS an inactive TARGET — nothing is written', async () => {
      const w = build();
      const pre = w.snapshot();
      await expect(w.service.create(USER, dto({ toCustomerId: I }))).rejects.toThrow(/C-I is inactive/);
      expect(w.snapshot()).toEqual(pre);
      expect(w.db.$transaction).not.toHaveBeenCalled();
    });

    it('ALLOWS an inactive SOURCE (transfer the balance, then deactivate)', async () => {
      const w = build();
      const r = await w.service.create(USER, dto({ fromCustomerId: I, toCustomerId: B, amount: 300 }));
      expect(w.bal(I)).toBe(0);
      expect(w.bal(B)).toBe(500);
      expect(r.sourceLeg.adjustment.customerId).toBe(I);
      expect(w.consistent(I)).toBe(true);
    });

    it('rolls back if the target is deactivated AFTER the pre-check (race) — 409, nothing moved', async () => {
      const w = build();
      w.s.precheck = () => {
        w.s.customers.get(B).isActive = false; // deactivated between the read and the write
      };
      await expect(w.service.create(USER, dto({ amount: 300 }))).rejects.toBeInstanceOf(ConflictException);
      expect(w.bal(A)).toBe(1000); // the source decrement (written first — A sorts before B) was undone
      expect(w.bal(B)).toBe(200);
      expect([w.s.groups.size, w.s.adjustments.size, w.s.transactions.size, w.s.audit.length]).toEqual([0, 0, 0, 0]);
      expect(w.cache.invalidateOverview).not.toHaveBeenCalled();
    });
  });

  describe('create: over-balance is blocked', () => {
    it('refuses more than the source owes, naming what it owes — nothing is written', async () => {
      const w = build();
      const pre = w.snapshot();
      await expect(w.service.create(USER, dto({ amount: 1000.01 }))).rejects.toThrow(/currently owes 1000\.00/);
      await expect(w.service.create(USER, dto({ amount: 5000 }))).rejects.toBeInstanceOf(BadRequestException);
      expect(w.snapshot()).toEqual(pre);
      expect(w.db.$transaction).not.toHaveBeenCalled();
    });

    it('refuses a source that owes nothing, or holds a CREDIT balance (V1: owed amounts only)', async () => {
      const zero = build();
      zero.s.customers.get(A).financialBalance = 0;
      await expect(zero.service.create(USER, dto({ amount: 1 }))).rejects.toThrow(/owes nothing/);

      const credit = build();
      credit.s.customers.get(A).financialBalance = -50;
      await expect(credit.service.create(USER, dto({ amount: 1 }))).rejects.toThrow(/owes nothing/);
      expect(credit.s.groups.size).toBe(0);
    });

    it('rolls back if the balance FALLS after the pre-check (race) — 409, source untouched, nothing posted', async () => {
      const w = build();
      w.s.precheck = () => {
        w.s.customers.get(A).financialBalance = 100; // e.g. a payment landed meanwhile
      };
      await expect(w.service.create(USER, dto({ amount: 300 }))).rejects.toThrow(/balance changed/);
      expect(w.bal(A)).toBe(100);
      expect(w.bal(B)).toBe(200);
      expect([w.s.groups.size, w.s.adjustments.size, w.s.transactions.size, w.s.audit.length]).toEqual([0, 0, 0, 0]);
    });
  });

  describe('create: input and permission', () => {
    it.each([[0], [-5], [10.005], [Number.NaN], [Number.POSITIVE_INFINITY]])('rejects amount %p before any database access', async (amount) => {
      const w = build();
      await expect(w.service.create(USER, dto({ amount }))).rejects.toBeInstanceOf(BadRequestException);
      expect(w.s.calls).toHaveLength(0);
    });

    it('requires an idempotency key', async () => {
      const w = build();
      await expect(w.service.create(USER, dto({ idempotencyKey: '   ' }))).rejects.toBeInstanceOf(BadRequestException);
      expect(w.s.calls).toHaveLength(0);
    });

    it('is refused without `transfer` — checked BEFORE any read, so customers cannot be probed', async () => {
      for (const granted of [[], [P('create'), P('create_credit'), P('create_restricted'), P('void'), P('view')]]) {
        const w = build(granted);
        await expect(w.service.create(USER, dto())).rejects.toBeInstanceOf(ForbiddenException);
        expect(w.s.calls).toHaveLength(0);
        expect(w.permissions.can).toHaveBeenCalledWith(USER.userId, P('transfer'));
      }
    });
  });

  describe('create: idempotency', () => {
    it('a retry with the same key returns the original transfer and posts NOTHING more', async () => {
      const w = build();
      const first = await w.service.create(USER, dto({ amount: 300, idempotencyKey: 'transfer-key-fixed' }));
      const pre = w.snapshot();
      w.s.customers.get(A).financialBalance -= 50; // live balance moves on (a payment)

      const again = await w.service.create(USER, dto({ amount: 300, idempotencyKey: 'transfer-key-fixed' }));
      expect(again.idempotentReplay).toBe(true);
      expect(again.group.id).toBe(first.group.id);
      expect(again.sourceLeg.adjustment.id).toBe(first.sourceLeg.adjustment.id);
      expect(again.targetLeg.transaction.id).toBe(first.targetLeg.transaction.id);
      expect(again.sourceBalance).toBe(650); // LIVE balance, not the stale one
      expect(w.db.$transaction).toHaveBeenCalledTimes(1);
      expect({ ...w.snapshot(), customers: pre.customers }).toEqual(pre);
      expect(w.cache.invalidateOverview).toHaveBeenCalledTimes(1); // no fan-out on a replay
    });

    it.each([
      ['a different amount', { amount: 301 }],
      ['a different target', { toCustomerId: I }],
      ['a different source', { fromCustomerId: B, toCustomerId: A }],
    ])('the same key with %s is a 409, not a silent drop', async (_label, override) => {
      const w = build();
      await w.service.create(USER, dto({ amount: 300, idempotencyKey: 'transfer-key-fixed' }));
      await expect(w.service.create(USER, dto({ idempotencyKey: 'transfer-key-fixed', ...override }))).rejects.toThrow(
        /already used for a different transfer/,
      );
      expect(w.bal(A)).toBe(700);
      expect(w.s.groups.size).toBe(1);
    });
  });

  describe('create: rollback — a failure at ANY step restores the whole world', () => {
    const points = [
      'group.create',
      'customer.updateMany',
      'customer.updateMany#2',
      'customer.findMany',
      'adjustment.create',
      'adjustment.create#2',
      'transaction.create',
      'transaction.create#2',
      'auditLog.create',
      'auditLog.create#2',
      'auditLog.create#3',
    ];
    describe.each([
      ['A→B (source written first)', A, B],
      ['B→A (source written second)', B, A],
    ])('%s', (_label, from, to) => {
      it.each(points)('fails at %s → deep-equal snapshot, nothing committed', async (point) => {
        const w = build();
        const pre = w.snapshot();
        w.s.failOn = point;
        await expect(w.service.create(USER, dto({ fromCustomerId: from, toCustomerId: to, amount: 150 }))).rejects.toThrow(
          `injected failure: ${point.replace(/#\d$/, '')}`,
        );
        expect(w.snapshot()).toEqual(pre);
        expect(w.s.committed).toEqual([]);
        expect(w.cache.invalidateOverview).not.toHaveBeenCalled();
      });
    });

    it('the net-zero invariant is enforced IN the transaction: a corrupt ledger amount rolls everything back', async () => {
      const w = build();
      const pre = w.snapshot();
      w.s.tamper = 0.01; // the target's ledger row comes back 0.01 too high
      await expect(w.service.create(USER, dto({ amount: 300 }))).rejects.toBeInstanceOf(InternalServerErrorException);
      expect(w.snapshot()).toEqual(pre);
      expect(w.s.committed).toEqual([]);
    });
  });

  // ══ concurrency ═════════════════════════════════════════════════════════════

  describe('concurrency', () => {
    it('two transfers racing for the same balance: exactly ONE wins, the loser rolls back with a 409', async () => {
      const w = build();
      const before = w.total();
      w.s.precheck = barrier(2); // both pass the (stale) pre-check, THEN race into the transaction
      const results = await Promise.allSettled([
        w.service.create(USER, dto({ amount: 700 })),
        w.service.create(USER, dto({ amount: 700 })),
      ]);

      const won = results.filter((r) => r.status === 'fulfilled');
      const lost = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(1);
      expect(lost[0].reason).toBeInstanceOf(ConflictException);
      expect(w.bal(A)).toBe(300); // only ONE 700 left the source — never negative, never double
      expect(w.bal(B)).toBe(900);
      expect([w.s.groups.size, w.s.adjustments.size, w.s.transactions.size]).toEqual([1, 2, 2]); // loser left no trace
      expect(w.total()).toBe(before); // receivables conserved
      expect(w.consistent(A) && w.consistent(B)).toBe(true);
      expect(w.cache.invalidateCustomerWallets).toHaveBeenCalledTimes(2); // winner only
    });

    it('N racing transfers can never overdraw the source: 3 × 400 from a balance of 1000 → exactly 2 win', async () => {
      const w = build();
      w.s.precheck = barrier(3);
      const results = await Promise.allSettled([1, 2, 3].map(() => w.service.create(USER, dto({ amount: 400 }))));

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
      expect(w.bal(A)).toBe(200);
      expect(w.bal(B)).toBe(1000);
      expect(w.s.groups.size).toBe(2);
      expect(w.consistent(A) && w.consistent(B)).toBe(true);
    });

    it('transfers that both fit both succeed, with independent legs', async () => {
      const w = build();
      w.s.precheck = barrier(2);
      const results = await Promise.all([
        w.service.create(USER, dto({ amount: 400 })),
        w.service.create(USER, dto({ amount: 500 })),
      ]);
      expect(results.map((r) => r.idempotentReplay)).toEqual([false, false]);
      expect(w.bal(A)).toBe(100);
      expect(w.bal(B)).toBe(1100);
      expect(w.s.adjustments.size).toBe(4);
    });

    it('A→B racing B→A: both succeed, and each transaction takes the row locks in the SAME order', async () => {
      const w = build();
      w.s.precheck = barrier(2);
      await Promise.all([
        w.service.create(USER, dto({ fromCustomerId: A, toCustomerId: B, amount: 300 })),
        w.service.create(USER, dto({ fromCustomerId: B, toCustomerId: A, amount: 100 })),
      ]);

      expect(w.bal(A)).toBe(800); // 1000 − 300 + 100
      expect(w.bal(B)).toBe(400); // 200 + 300 − 100
      const byTx = new Map<number, string[]>();
      for (const c of w.s.calls.filter((c) => c.op === 'customer.updateMany')) {
        byTx.set(c.tx!, [...(byTx.get(c.tx!) ?? []), c.args.where.id]);
      }
      expect(byTx.size).toBe(2);
      for (const order of byTx.values()) expect(order).toEqual([A, B]); // ascending, never [B, A]
    });

    it('a double-submit (same key, racing) moves the money ONCE; the second call replays the winner', async () => {
      const w = build();
      w.s.precheck = barrier(2);
      const results = await Promise.all([
        w.service.create(USER, dto({ amount: 300, idempotencyKey: 'transfer-key-double' })),
        w.service.create(USER, dto({ amount: 300, idempotencyKey: 'transfer-key-double' })),
      ]);

      expect(results.map((r) => r.idempotentReplay).sort()).toEqual([false, true]);
      expect(results[0].group.id).toBe(results[1].group.id);
      expect(w.bal(A)).toBe(700);
      expect(w.bal(B)).toBe(500);
      expect([w.s.groups.size, w.s.adjustments.size, w.s.transactions.size]).toEqual([1, 2, 2]);
    });
  });

  // ══ void ════════════════════════════════════════════════════════════════════

  describe('voidTransfer: the group void restores BOTH sides', () => {
    async function posted(amount = 300) {
      const w = build();
      const t = await w.service.create(USER, dto({ amount }));
      const pre = w.snapshot();
      jest.setSystemTime(LATER);
      return { w, t, pre };
    }

    it('restores both balances exactly, voids the group + both legs, posts two reversals', async () => {
      const { w, t } = await posted(123.45);
      const v = await w.service.voidTransfer(USER, t.group.id, voidDto());

      expect(w.bal(A)).toBe(1000);
      expect(w.bal(B)).toBe(200);
      expect([round2(v.sourceBalance), round2(v.targetBalance)]).toEqual([1000, 200]);
      expect(w.consistent(A)).toBe(true);
      expect(w.consistent(B)).toBe(true);

      expect(v.group).toMatchObject({ status: 'VOIDED', voidedById: USER.userId, voidedAt: LATER, voidReason: REASON });
      expect(v.voidedSourceLeg).toMatchObject({ status: 'VOIDED', voidedById: USER.userId, voidReason: REASON });
      expect(v.voidedTargetLeg).toMatchObject({ status: 'VOIDED', voidedById: USER.userId, voidReason: REASON });
      expect(w.s.adjustments.get(t.sourceLeg.adjustment.id).status).toBe('VOIDED');
      expect(w.s.adjustments.get(t.targetLeg.adjustment.id).status).toBe('VOIDED');
    });

    it('the reversals are linked to their legs, opposite in direction, dated the void moment, and net to ZERO', async () => {
      const { w, t } = await posted(300);
      const v = await w.service.voidTransfer(USER, t.group.id, voidDto());

      expect(v.sourceReversal.adjustment).toMatchObject({
        kind: 'REVERSAL',
        direction: 'CHARGE', // reverses the source's CREDIT
        customerId: A,
        amount: 300,
        reversalOfId: t.sourceLeg.adjustment.id,
        effectiveDate: LATER,
        internalNote: REASON,
        counterpartyCustomerId: B,
        groupId: null, // the group stays exactly its two original documents
      });
      expect(v.targetReversal.adjustment).toMatchObject({
        kind: 'REVERSAL',
        direction: 'CREDIT', // reverses the target's CHARGE
        customerId: B,
        amount: 300,
        reversalOfId: t.targetLeg.adjustment.id,
        effectiveDate: LATER,
        counterpartyCustomerId: A,
        groupId: null,
      });
      // exact negation of the original ledger rows, linked to the reversals, dated the void moment
      expect(v.sourceReversal.transaction).toMatchObject({
        customerId: A,
        adjustmentId: v.sourceReversal.adjustment.id,
        amount: 300,
        createdAt: LATER,
        description: 'Reversal: Balance transferred to C-B',
      });
      expect(v.targetReversal.transaction).toMatchObject({
        customerId: B,
        adjustmentId: v.targetReversal.adjustment.id,
        amount: -300,
        createdAt: LATER,
        description: 'Reversal: Balance transferred from C-A',
      });
      expect(v.sourceReversal.transaction.amount + v.targetReversal.transaction.amount).toBe(0);
      // the whole ledger (2 originals + 2 reversals) nets to zero, and only the group's two legs carry groupId
      expect([...w.s.transactions.values()].reduce((n, x) => n + Math.round(x.amount * 100), 0)).toBe(0);
      expect(w.s.transactions.size).toBe(4);
      expect([...w.s.adjustments.values()].filter((a) => a.groupId === t.group.id)).toHaveLength(2);
    });

    it('never edits the ORIGINAL ledger rows (append-only)', async () => {
      const { w, t, pre } = await posted(300);
      await w.service.voidTransfer(USER, t.group.id, voidDto());
      for (const original of pre.transactions) {
        expect(w.s.transactions.get(original.id)).toEqual(original);
      }
    });

    it('is ONE atomic transaction; audit = VOID on the group and each leg + CREATE on each reversal (5 rows)', async () => {
      const { w, t } = await posted(300);
      const before = w.s.audit.length;
      w.s.committed.length = 0;
      const v = await w.service.voidTransfer(USER, t.group.id, voidDto());

      expect(w.db.$transaction).toHaveBeenCalledTimes(2); // the post + the void
      expect(w.s.outside).toEqual([]);
      const rows = w.s.audit.slice(before);
      expect(rows).toHaveLength(5);
      expect(rows.filter((a) => a.action === 'VOID').map((a) => a.entity).sort()).toEqual([
        'CustomerFinancialAdjustment',
        'CustomerFinancialAdjustment',
        'CustomerFinancialAdjustmentGroup',
      ]);
      expect(rows.filter((a) => a.action === 'CREATE').map((a) => a.entityId).sort()).toEqual(
        [v.sourceReversal.adjustment.id, v.targetReversal.adjustment.id].sort(),
      );
      expect(rows.every((a) => a.changes.reason === REASON)).toBe(true);
      expect(w.s.committed.filter((o) => o === 'auditLog.create')).toHaveLength(5);
    });

    it('locks both customers in sorted-id order', async () => {
      const { w, t } = await posted(300);
      w.s.calls.length = 0;
      await w.service.voidTransfer(USER, t.group.id, voidDto());
      expect(w.s.calls.filter((c) => c.op === 'customer.update').map((c) => c.args.where.id)).toEqual([A, B]);
    });

    it('has NO balance floor: if the target already paid down the transfer, voiding leaves it with a credit', async () => {
      const { w, t } = await posted(300); // B now owes 500
      w.s.customers.get(B).financialBalance -= 500; // B pays everything
      w.s.transactions.set('pay-1', { id: 'pay-1', type: 'PAYMENT', customerId: B, amount: -500 });
      await w.service.voidTransfer(USER, t.group.id, voidDto());

      expect(w.bal(A)).toBe(1000); // source charged back in full
      expect(w.bal(B)).toBe(-300); // target: 200 + 300 − 500 − 300 → credit, the truth
      expect(w.consistent(B)).toBe(true);
    });

    it('a second void is a 409 and changes nothing', async () => {
      const { w, t } = await posted(300);
      await w.service.voidTransfer(USER, t.group.id, voidDto());
      const pre = w.snapshot();
      await expect(w.service.voidTransfer(USER, t.group.id, voidDto())).rejects.toThrow(/already been voided/);
      expect(w.snapshot()).toEqual(pre);
    });

    it('two racing voids: exactly ONE succeeds, both sides are restored ONCE', async () => {
      const { w, t } = await posted(300);
      const results = await Promise.allSettled([
        w.service.voidTransfer(USER, t.group.id, voidDto()),
        w.service.voidTransfer(USER, t.group.id, voidDto()),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const lost = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')!;
      expect(lost.reason).toBeInstanceOf(ConflictException);
      expect(w.bal(A)).toBe(1000);
      expect(w.bal(B)).toBe(200);
      expect(w.s.transactions.size).toBe(4); // one set of reversals, not two
      expect(w.consistent(A) && w.consistent(B)).toBe(true);
    });

    it('a single leg can NEVER be voided alone: the existing single-adjustment void refuses it', async () => {
      const { w, t, pre } = await posted(300);
      for (const leg of [t.sourceLeg.adjustment, t.targetLeg.adjustment]) {
        await expect(w.single.voidAdjustment(USER, leg.id, voidDto())).rejects.toThrow(/one leg of a balance transfer/);
      }
      expect(w.snapshot()).toEqual(pre);
    });

    it('a transfer can be voided, and the SAME accounts can transfer again afterwards', async () => {
      const { w, t } = await posted(300);
      await w.service.voidTransfer(USER, t.group.id, voidDto());
      await w.service.create(USER, dto({ amount: 300 }));
      expect(w.bal(A)).toBe(700);
      expect(w.bal(B)).toBe(500);
      expect(w.consistent(A) && w.consistent(B)).toBe(true);
    });

    it('invalidates the caches after commit for both customers', async () => {
      const { w, t } = await posted(300);
      w.cache.invalidateCustomerWallets.mockClear();
      await w.service.voidTransfer(USER, t.group.id, voidDto());
      expect(w.cache.invalidateCustomerWallets.mock.calls.map((c) => c[1]).sort()).toEqual([A, B]);
    });
  });

  describe('voidTransfer: guards (nothing is written when refused)', () => {
    it.each([
      ['void only', [P('void')]],
      ['transfer only', [P('transfer')]],
      ['view only', [P('view')]],
      ['nothing', []],
    ])('needs BOTH `void` and `transfer` — refused with %s, before any read', async (_l, granted) => {
      const w = build(granted);
      await expect(w.service.voidTransfer(USER, 'grp-1', voidDto())).rejects.toBeInstanceOf(ForbiddenException);
      expect(w.s.calls).toHaveLength(0);
    });

    it('requires a reason of at least 5 characters', async () => {
      const w = build();
      const t = await w.service.create(USER, dto());
      const pre = w.snapshot();
      for (const reason of ['', '    ', 'abcd']) {
        await expect(w.service.voidTransfer(USER, t.group.id, voidDto(reason))).rejects.toBeInstanceOf(BadRequestException);
      }
      expect(w.snapshot()).toEqual(pre);
    });

    it('404s an unknown group, and a group of ANOTHER vendor', async () => {
      const w = build();
      await expect(w.service.voidTransfer(USER, 'nope', voidDto())).rejects.toBeInstanceOf(NotFoundException);

      const t = await w.service.create(USER, dto());
      const pre = w.snapshot();
      const foreign: AuthUser = { ...USER, vendorId: OTHER_VENDOR_ID };
      await expect(w.service.voidTransfer(foreign, t.group.id, voidDto())).rejects.toBeInstanceOf(NotFoundException);
      expect(w.snapshot()).toEqual(pre);
      expect(w.s.calls.filter((c) => c.op === 'group.findFirst').pop()!.args.where).toMatchObject({ vendorId: OTHER_VENDOR_ID });
    });

    describe('refuses an inconsistent group rather than compound the damage (409, no writes)', () => {
      const corruptions: [string, (w: ReturnType<typeof build>, t: any) => void][] = [
        ['a missing leg', (w, t) => void w.s.adjustments.delete(t.targetLeg.adjustment.id)],
        ['legs of different amounts', (w, t) => void (w.s.adjustments.get(t.targetLeg.adjustment.id).amount = 250)],
        ['a missing ledger row', (w, t) => void w.s.transactions.delete(t.sourceLeg.transaction.id)],
        ['a ledger row that disagrees with its leg', (w, t) => void (w.s.transactions.get(t.targetLeg.transaction.id).amount = 299)],
        ['a leg that is already VOIDED while the group is POSTED', (w, t) => void (w.s.adjustments.get(t.sourceLeg.adjustment.id).status = 'VOIDED')],
        ['legs that do not name each other as counterparty', (w, t) => void (w.s.adjustments.get(t.sourceLeg.adjustment.id).counterpartyCustomerId = I)],
      ];
      it.each(corruptions)('%s', async (_label, corrupt) => {
        const w = build();
        const t = await w.service.create(USER, dto({ amount: 300 }));
        corrupt(w, t);
        const pre = w.snapshot();
        await expect(w.service.voidTransfer(USER, t.group.id, voidDto())).rejects.toBeInstanceOf(ConflictException);
        expect(w.snapshot()).toEqual(pre);
        expect(w.db.$transaction).toHaveBeenCalledTimes(1); // only the original post
      });
    });
  });

  describe('voidTransfer: rollback — a failure at ANY step restores the post-transfer state', () => {
    const points = [
      'group.updateMany',
      'adjustment.updateMany',
      'adjustment.updateMany#2',
      'customer.update',
      'customer.update#2',
      'adjustment.create',
      'adjustment.create#2',
      'transaction.create',
      'transaction.create#2',
      'auditLog.create',
      'auditLog.create#3',
      'auditLog.create#5',
      'group.findUniqueOrThrow',
      'adjustment.findUniqueOrThrow#2',
    ];
    it.each(points)('fails at %s → deep-equal snapshot, balances still transferred', async (point) => {
      const w = build();
      const t = await w.service.create(USER, dto({ amount: 300 }));
      const pre = w.snapshot();
      w.s.committed.length = 0;
      w.s.failOn = point;
      await expect(w.service.voidTransfer(USER, t.group.id, voidDto())).rejects.toThrow(
        `injected failure: ${point.replace(/#\d$/, '')}`,
      );
      expect(w.snapshot()).toEqual(pre);
      expect([w.bal(A), w.bal(B)]).toEqual([700, 500]);
      expect(w.s.committed).toEqual([]);
    });

    it('the net-zero invariant on the reversals is enforced IN the transaction', async () => {
      const w = build();
      const t = await w.service.create(USER, dto({ amount: 300 }));
      const pre = w.snapshot();
      // Positive ledger rows come back 0.01 too high — here the SOURCE's reversal (+300 → 300.01),
      // so the two reversal rows no longer cancel.
      w.s.tamper = 0.01;
      await expect(w.service.voidTransfer(USER, t.group.id, voidDto())).rejects.toBeInstanceOf(InternalServerErrorException);
      expect(w.snapshot()).toEqual(pre);
    });
  });

  // ══ preview ═════════════════════════════════════════════════════════════════

  describe('preview', () => {
    it('returns the live balance, transferable amount, deactivation blockers and the target — as a pure read', async () => {
      const w = build();
      w.s.pendingItems[A] = 2;
      w.s.wallets.push(
        { customerId: A, balance: 3, product: { name: '19L Bottle' } },
        { customerId: A, balance: 2, product: { name: '5L Bottle' } },
        { customerId: A, balance: -1, product: { name: 'Dispenser' } },
      );
      const p = await w.service.preview(VENDOR_ID, { fromCustomerId: A, toCustomerId: B });

      expect(p.source).toMatchObject({
        id: A,
        customerCode: 'C-A',
        isActive: true,
        financialBalance: 1000,
        transferableAmount: 1000,
        pendingDeliveryCount: 2,
        heldBottleCount: 5, // physically held: positive wallet balances only
      });
      expect(p.source.heldBottles).toEqual([
        { product: '19L Bottle', balance: 3 },
        { product: '5L Bottle', balance: 2 },
        { product: 'Dispenser', balance: -1 },
      ]);
      expect(p.target).toMatchObject({ id: B, isActive: true, financialBalance: 200 });
      expect(p.canTransfer).toBe(true);
      expect(p.blockers).toEqual([]);
      expect(w.db.$transaction).not.toHaveBeenCalled();
      expect(w.s.outside).toEqual([]); // nothing written
    });

    it('works without a target (source side only)', async () => {
      const w = build();
      const p = await w.service.preview(VENDOR_ID, { fromCustomerId: A });
      expect(p.target).toBeNull();
      expect(p.canTransfer).toBe(true);
    });

    it('an INACTIVE source is fine (flagged, not blocked); an inactive TARGET is a blocker', async () => {
      const w = build();
      const src = await w.service.preview(VENDOR_ID, { fromCustomerId: I, toCustomerId: B });
      expect(src.source.isActive).toBe(false);
      expect(src.canTransfer).toBe(true);

      const tgt = await w.service.preview(VENDOR_ID, { fromCustomerId: A, toCustomerId: I });
      expect(tgt.canTransfer).toBe(false);
      expect(tgt.blockers.map((b) => b.code)).toEqual(['TARGET_INACTIVE']);
    });

    it('flags a source that owes nothing / holds credit, and the same customer on both sides', async () => {
      const w = build();
      w.s.customers.get(A).financialBalance = -20;
      const p = await w.service.preview(VENDOR_ID, { fromCustomerId: A, toCustomerId: A });
      expect(p.source.transferableAmount).toBe(0);
      expect(p.blockers.map((b) => b.code).sort()).toEqual(['SAME_CUSTOMER', 'SOURCE_HAS_NO_BALANCE']);
      expect(p.canTransfer).toBe(false);
    });

    it('is vendor-scoped: a customer in ANOTHER vendor is a 404 on either side', async () => {
      const w = build();
      await expect(w.service.preview(VENDOR_ID, { fromCustomerId: X })).rejects.toThrow(new NotFoundException('Source customer not found'));
      await expect(w.service.preview(VENDOR_ID, { fromCustomerId: A, toCustomerId: X })).rejects.toThrow(
        new NotFoundException('Target customer not found'),
      );
      await expect(w.service.preview(OTHER_VENDOR_ID, { fromCustomerId: A })).rejects.toBeInstanceOf(NotFoundException);
      for (const c of w.s.calls.filter((c) => c.op === 'customer.findMany')) expect(c.args.where.vendorId).toBeDefined();
    });
  });
});
