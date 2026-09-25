import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TransactionType } from '@prisma/client';
import type { AuthUser } from '@water-supply-crm/types';
import { CustomerFinancialAdjustmentService } from './customer-financial-adjustment.service';

const VENDOR_ID = 'vendor-1';
const OTHER_VENDOR_ID = 'vendor-2';
const CUSTOMER_ID = 'customer-1';
const USER: AuthUser = {
  userId: 'user-1',
  email: 'accountant@example.com',
  name: 'Bilal Accountant',
  role: 'STAFF',
  vendorId: VENDOR_ID,
  customerId: null,
};
const P = (a: string) => `customer_financial_adjustments:${a}`;
const round2 = (n: number) => Math.round(n * 100) / 100;
const REASON = 'Entered against the wrong customer';
const NOW = new Date('2026-09-20T09:00:00.000Z');

/**
 * STATEFUL in-memory ledger. Unlike the 2A harness (call-count based), this one holds
 * real state — balance, adjustment documents, ledger rows, audit rows — and gives every
 * `$transaction` its OWN undo log, so:
 *   - a failure at any write really restores the world (asserted by deep-equal snapshots);
 *   - two transactions can be in flight at once (the double-void race);
 *   - `updateMany` is atomic, like a row-locked UPDATE, so the claim-first guard is
 *     genuinely exercised.
 * Writes made on the plain client (outside a transaction) land in `s.outside`.
 */
function buildWorld(base = 1000) {
  const s = {
    base,
    balance: base,
    adjustments: new Map<string, any>(),
    transactions: new Map<string, any>(),
    audit: [] as any[],
    committed: [] as string[],
    outside: [] as string[],
    calls: [] as { op: string; args: any }[],
    failOn: null as string | null,
    seq: 0,
  };
  const nextId = (p: string) => `${p}-${++s.seq}`;
  const p2002 = () =>
    new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' });

  const client = (undo: (() => void)[] | null, writes: string[] | null) => {
    const counts: Record<string, number> = {};
    const track = (op: string, args: unknown) => {
      s.calls.push({ op, args });
      counts[op] = (counts[op] ?? 0) + 1;
      if ((s.failOn === op && counts[op] === 1) || s.failOn === `${op}#${counts[op]}`) {
        throw new Error(`injected failure: ${op}`);
      }
    };
    const wrote = (op: string) => (writes ? writes.push(op) : s.outside.push(op));
    const matches = (d: any, where: Record<string, unknown>) =>
      Object.entries(where).every(([k, v]) => d[k] === v);
    const withTxn = (d: any, include?: { transaction?: boolean; causedByStaffLedgerEntry?: unknown }) => {
      const out = structuredClone(d);
      if (include?.transaction) {
        const t = [...s.transactions.values()].find((x) => x.adjustmentId === d.id);
        out.transaction = t ? structuredClone(t) : null;
      }
      if (include?.causedByStaffLedgerEntry) {
        out.causedByStaffLedgerEntry = d.linkedFromStaffLedgerEntryId
          ? { id: d.linkedFromStaffLedgerEntryId }
          : null;
      }
      return out;
    };

    return {
      customer: {
        findFirst: async (args: any) => {
          track('customer.findFirst', args);
          return args.where.id === CUSTOMER_ID && args.where.vendorId === VENDOR_ID ? { id: CUSTOMER_ID } : null;
        },
        findUnique: async (args: any) => {
          track('customer.findUnique', args);
          return { financialBalance: s.balance };
        },
        update: async (args: any) => {
          track('customer.update', args);
          const inc: number = args.data.financialBalance.increment;
          s.balance = round2(s.balance + inc);
          wrote('customer.update');
          undo?.push(() => {
            s.balance = round2(s.balance - inc);
          });
          return { financialBalance: s.balance };
        },
      },
      customerFinancialAdjustment: {
        findFirst: async (args: any) => {
          track('adjustment.findFirst', args);
          const d = [...s.adjustments.values()].find((x) => matches(x, args.where));
          return d ? withTxn(d, args.include) : null;
        },
        findUniqueOrThrow: async (args: any) => {
          track('adjustment.findUniqueOrThrow', args);
          const d = s.adjustments.get(args.where.id);
          if (!d) throw new Error('not found');
          return structuredClone(d);
        },
        create: async (args: any) => {
          track('adjustment.create', args);
          const d = {
            id: nextId('adj'),
            status: 'POSTED',
            groupId: null,
            reversalOfId: null,
            internalNote: null,
            referenceNo: null,
            voidedById: null,
            voidedAt: null,
            voidReason: null,
            idempotencyKey: null,
            counterpartyCustomerId: null,
            ...args.data,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          const all = [...s.adjustments.values()];
          if (d.reversalOfId && all.some((x) => x.reversalOfId === d.reversalOfId)) throw p2002();
          if (d.idempotencyKey && all.some((x) => x.vendorId === d.vendorId && x.idempotencyKey === d.idempotencyKey)) {
            throw p2002();
          }
          s.adjustments.set(d.id, d);
          wrote('adjustment.create');
          undo?.push(() => s.adjustments.delete(d.id));
          return structuredClone(d);
        },
        updateMany: async (args: any) => {
          track('adjustment.updateMany', args);
          let count = 0;
          for (const d of s.adjustments.values()) {
            if (!matches(d, args.where)) continue;
            const prev = { ...d };
            Object.assign(d, args.data);
            undo?.push(() => Object.assign(d, prev));
            count++;
          }
          wrote('adjustment.updateMany');
          return { count };
        },
      },
      transaction: {
        create: async (args: any) => {
          track('transaction.create', args);
          const t = { id: nextId('txn'), ...args.data, createdAt: args.data.createdAt ?? new Date() };
          s.transactions.set(t.id, t);
          wrote('transaction.create');
          undo?.push(() => s.transactions.delete(t.id));
          return structuredClone(t);
        },
      },
      auditLog: {
        create: async (args: any) => {
          track('auditLog.create', args);
          const a = { id: nextId('audit'), ...args.data };
          s.audit.push(a);
          wrote('auditLog.create');
          undo?.push(() => {
            s.audit.splice(s.audit.indexOf(a), 1);
          });
          return structuredClone(a);
        },
      },
    };
  };

  const db: any = client(null, null);
  db.$transaction = jest.fn(async (fn: (tx: any) => Promise<unknown>) => {
    const undo: (() => void)[] = [];
    const writes: string[] = [];
    try {
      const result = await fn(client(undo, writes));
      s.committed.push(...writes);
      return result;
    } catch (e) {
      for (const u of undo.reverse()) u();
      throw e;
    }
  });

  /** Insert an already-POSTED adjustment + its ledger row, moving the balance like a real post. */
  const seed = (o: {
    id?: string;
    kind?: string;
    direction?: 'CHARGE' | 'CREDIT';
    amount?: number;
    title?: string;
    visibility?: 'ITEMIZED' | 'SUMMARIZED';
    effectiveDate?: Date;
    vendorId?: string;
    groupId?: string | null;
    status?: string;
    reversalOfId?: string | null;
    ledger?: 'ok' | 'none' | number;
    linkedFromStaffLedgerEntryId?: string | null;
  } = {}) => {
    const direction = o.direction ?? 'CHARGE';
    const amount = o.amount ?? 500;
    const id = o.id ?? nextId('adj-seed');
    const effectiveDate = o.effectiveDate ?? new Date('2026-09-05T00:00:00.000Z');
    s.adjustments.set(id, {
      id,
      vendorId: o.vendorId ?? VENDOR_ID,
      customerId: CUSTOMER_ID,
      kind: o.kind ?? 'PENALTY',
      direction,
      amount,
      effectiveDate,
      title: o.title ?? 'Late payment penalty',
      internalNote: null,
      customerVisibility: o.visibility ?? 'ITEMIZED',
      status: o.status ?? 'POSTED',
      groupId: o.groupId ?? null,
      reversalOfId: o.reversalOfId ?? null,
      voidedById: null,
      voidedAt: null,
      voidReason: null,
      createdById: 'someone',
      linkedFromStaffLedgerEntryId: o.linkedFromStaffLedgerEntryId ?? null,
    });
    const ledger = o.ledger ?? 'ok';
    if (ledger !== 'none') {
      const signed = typeof ledger === 'number' ? ledger : direction === 'CHARGE' ? amount : -amount;
      const t = { id: `txn-of-${id}`, type: 'ADJUSTMENT', vendorId: o.vendorId ?? VENDOR_ID, customerId: CUSTOMER_ID, adjustmentId: id, amount: signed, description: o.title ?? 'Late payment penalty', createdAt: effectiveDate };
      s.transactions.set(t.id, t);
      s.balance = round2(s.balance + signed);
    }
    return id;
  };

  const consistent = () => {
    const sum = [...s.transactions.values()].reduce((a, t) => a + t.amount, 0);
    return round2(s.base + sum) === s.balance;
  };
  const snapshot = () => ({
    balance: s.balance,
    adjustments: structuredClone([...s.adjustments.values()]),
    transactions: structuredClone([...s.transactions.values()]),
    audit: structuredClone(s.audit),
  });

  return { s, db, seed, consistent, snapshot };
}

function build(granted: string[] = [P('void')], base = 1000) {
  const world = buildWorld(base);
  const cache = {
    invalidateVendorEntity: jest.fn().mockResolvedValue(undefined),
    invalidateOverview: jest.fn().mockResolvedValue(undefined),
    invalidateAnalytics: jest.fn().mockResolvedValue(undefined),
    invalidateCustomerWallets: jest.fn().mockResolvedValue(undefined),
  };
  const permissions = { can: jest.fn(async (_u: string, perm: string) => granted.includes(perm)) };
  const service = new CustomerFinancialAdjustmentService(world.db, cache as any, permissions as any);
  return { service, cache, permissions, ...world };
}

const voidDto = (reason = REASON) => ({ reason }) as any;

describe('CustomerFinancialAdjustmentService.voidAdjustment', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout'] }).setSystemTime(NOW);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  // ── Success ───────────────────────────────────────────────────────────────────
  describe('success', () => {
    it('voids: original → VOIDED, reversal created, balance restored', async () => {
      const t = build();
      const id = t.seed({ kind: 'PENALTY', direction: 'CHARGE', amount: 500 }); // balance 1500
      expect(t.s.balance).toBe(1500);

      const result = await t.service.voidAdjustment(USER, id, voidDto());

      // Original: VOIDED with who / when / why.
      expect(result.adjustment).toMatchObject({
        id,
        status: 'VOIDED',
        voidedById: USER.userId,
        voidReason: REASON,
      });
      expect(result.adjustment.voidedAt).toEqual(NOW);

      // Reversal document: chained to the original, opposite direction, same amount, dated NOW.
      expect(result.reversal).toMatchObject({
        kind: 'REVERSAL',
        direction: 'CREDIT', // opposite of the original CHARGE
        amount: 500,
        status: 'POSTED',
        reversalOfId: id,
        customerId: CUSTOMER_ID,
        vendorId: VENDOR_ID,
        createdById: USER.userId,
        customerVisibility: 'ITEMIZED',
        internalNote: REASON,
        title: 'Reversal: Late payment penalty',
      });
      expect(result.reversal.effectiveDate).toEqual(NOW);

      // Balance back to where it was before the adjustment.
      expect(result.customerBalance).toBe(1000);
      expect(t.s.balance).toBe(1000);
      expect(t.consistent()).toBe(true);
      expect(t.s.outside).toEqual([]);
    });

    it('posts the opposite-signed ledger row, linked to the REVERSAL, dated the void moment', async () => {
      const t = build();
      const id = t.seed({ direction: 'CHARGE', amount: 500 });

      const { reversal, reversalTransaction } = await t.service.voidAdjustment(USER, id, voidDto());

      expect(reversalTransaction).toMatchObject({
        type: TransactionType.ADJUSTMENT,
        vendorId: VENDOR_ID,
        customerId: CUSTOMER_ID,
        adjustmentId: reversal.id, // the reversal's — NOT the original's
        amount: -500,
        description: 'Reversal: Late payment penalty',
      });
      expect(reversalTransaction.createdAt).toEqual(NOW);
      const row = t.s.transactions.get(reversalTransaction.id);
      expect('productId' in row).toBe(false);
      expect('bottleCount' in row).toBe(false);
    });

    it('reverses a CREDIT with a CHARGE (balance goes back UP)', async () => {
      const t = build();
      const id = t.seed({ kind: 'DISCOUNT', direction: 'CREDIT', amount: 300 }); // balance 700

      const { reversal, reversalTransaction, customerBalance } = await t.service.voidAdjustment(USER, id, voidDto());

      expect(reversal.direction).toBe('CHARGE');
      expect(reversalTransaction.amount).toBe(300);
      expect(customerBalance).toBe(1000);
      expect(t.consistent()).toBe(true);
    });

    it('never touches the ORIGINAL ledger row', async () => {
      const t = build();
      const id = t.seed();
      const before = structuredClone(t.s.transactions.get(`txn-of-${id}`));

      await t.service.voidAdjustment(USER, id, voidDto());

      expect(t.s.transactions.get(`txn-of-${id}`)).toEqual(before);
      // ...and it is now one of exactly two rows: the original + its reversal.
      expect(t.s.transactions.size).toBe(2);
    });

    it('dates the reversal at the ACTUAL void moment even when the original was backdated', async () => {
      const t = build();
      const backdated = new Date('2026-09-02T00:00:00.000Z');
      const id = t.seed({ effectiveDate: backdated });

      const { reversal, reversalTransaction } = await t.service.voidAdjustment(USER, id, voidDto());

      expect(reversal.effectiveDate).toEqual(NOW);
      expect(reversalTransaction.createdAt).toEqual(NOW);
      expect(t.s.transactions.get(`txn-of-${id}`).createdAt).toEqual(backdated); // original untouched
    });

    it('trims the reason', async () => {
      const t = build();
      const id = t.seed();
      const { adjustment } = await t.service.voidAdjustment(USER, id, voidDto(`   ${REASON}   `));
      expect(adjustment.voidReason).toBe(REASON);
    });
  });

  // ── Round trip through the real `create` (2A) ────────────────────────────────
  describe('round trip: post via create(), then void', () => {
    const KINDS = [
      ['SERVICE_FEE', 'CHARGE'],
      ['PENALTY', 'CHARGE'],
      ['OTHER_CHARGE', 'CHARGE'],
      ['DISCOUNT', 'CREDIT'],
      ['GOODWILL_CREDIT', 'CREDIT'],
      ['OTHER_CREDIT', 'CREDIT'],
    ] as const;

    it.each(KINDS)('%s (%s): balance is restored to the cent and the pair nets to zero', async (kind, direction) => {
      const t = build([P('create'), P('create_credit'), P('void')], 1234.56);
      const posted = await t.service.create(USER, {
        customerId: CUSTOMER_ID,
        kind,
        amount: 99.99,
        title: 'Round trip',
        internalNote: 'why',
        idempotencyKey: `round-trip-${kind}-1234`,
      } as any);
      expect(t.s.balance).not.toBe(1234.56);

      jest.setSystemTime(new Date('2026-09-21T09:00:00.000Z')); // void happens later
      const voided = await t.service.voidAdjustment(USER, posted.adjustment.id, voidDto());

      expect(t.s.balance).toBe(1234.56);
      expect(voided.reversal.direction).toBe(direction === 'CHARGE' ? 'CREDIT' : 'CHARGE');
      expect(voided.reversalTransaction.amount + posted.transaction.amount).toBe(0);
      expect(voided.reversalTransaction.createdAt).toEqual(new Date('2026-09-21T09:00:00.000Z'));
      expect(t.consistent()).toBe(true);
    });
  });

  // ── Customer-facing wording ───────────────────────────────────────────────────
  describe('customer-facing wording (the portal returns raw ledger rows)', () => {
    it('ITEMIZED: the reversal names what was reversed', async () => {
      const t = build();
      const id = t.seed({ title: 'Installation charge' });
      const { reversalTransaction } = await t.service.voidAdjustment(USER, id, voidDto());
      expect(reversalTransaction.description).toBe('Reversal: Installation charge');
    });

    it('SUMMARIZED: stays neutral — voiding must not un-hide a write-off, and no staff title leaks', async () => {
      const t = build();
      const id = t.seed({ kind: 'WRITE_OFF', direction: 'CREDIT', visibility: 'SUMMARIZED', title: 'INTERNAL: duplicate fix' });
      const { reversal, reversalTransaction } = await t.service.voidAdjustment(USER, id, voidDto());

      expect(reversal.customerVisibility).toBe('SUMMARIZED');
      expect(reversalTransaction.description).toBe('Account adjustment reversal');
      expect(JSON.stringify(t.s.transactions.get(reversalTransaction.id))).not.toContain('INTERNAL');
    });

    it('the void reason is staff-only: never on the ledger row', async () => {
      const t = build();
      const id = t.seed();
      const { reversalTransaction } = await t.service.voidAdjustment(USER, id, voidDto('SECRET owner said refund'));
      expect(JSON.stringify(t.s.transactions.get(reversalTransaction.id))).not.toContain('SECRET');
    });
  });

  // ── Audit trail ───────────────────────────────────────────────────────────────
  describe('audit trail', () => {
    it('writes one VOID row on the original and one CREATE row on the reversal, both linked', async () => {
      const t = build();
      const id = t.seed({ amount: 500 });

      const { reversal, reversalTransaction } = await t.service.voidAdjustment(USER, id, voidDto());

      expect(t.s.audit).toHaveLength(2);
      const [voidRow, createRow] = t.s.audit;

      expect(voidRow).toMatchObject({
        vendorId: VENDOR_ID,
        userId: USER.userId,
        userName: 'Bilal Accountant',
        action: 'VOID',
        entity: 'CustomerFinancialAdjustment',
        entityId: id,
      });
      expect(voidRow.changes.before).toEqual({ status: 'POSTED', financialBalance: 1500 });
      expect(voidRow.changes.after).toMatchObject({
        status: 'VOIDED',
        reversalId: reversal.id,
        reversalTransactionId: reversalTransaction.id,
        reversalSignedAmount: -500,
        financialBalance: 1000,
      });
      expect(voidRow.changes.reason).toBe(REASON);

      expect(createRow).toMatchObject({
        userId: USER.userId,
        action: 'CREATE',
        entity: 'CustomerFinancialAdjustment',
        entityId: reversal.id,
      });
      expect(createRow.changes.after).toMatchObject({
        kind: 'REVERSAL',
        reversalOfId: id,
        signedAmount: -500,
        transactionId: reversalTransaction.id,
      });
      expect(createRow.changes.reason).toBe(REASON);
    });

    it('is written inside the same transaction as everything else (5 writes + 1 audit, none outside)', async () => {
      const t = build();
      const id = t.seed();
      await t.service.voidAdjustment(USER, id, voidDto());

      expect(t.db.$transaction).toHaveBeenCalledTimes(1);
      expect(t.s.outside).toEqual([]);
      expect([...t.s.committed].sort()).toEqual(
        ['adjustment.create', 'adjustment.updateMany', 'auditLog.create', 'auditLog.create', 'customer.update', 'transaction.create'],
      );
    });
  });

  // ── Guards ────────────────────────────────────────────────────────────────────
  describe('guards (nothing is written when refused)', () => {
    const expectUntouched = (t: ReturnType<typeof build>, before: ReturnType<ReturnType<typeof build>['snapshot']>) => {
      expect(t.snapshot()).toEqual(before);
      expect(t.s.committed).toEqual([]);
      expect(t.s.outside).toEqual([]);
      expect(t.cache.invalidateVendorEntity).not.toHaveBeenCalled();
    };

    it('blocks a DOUBLE void: the second attempt is a 409 and changes nothing', async () => {
      const t = build();
      const id = t.seed();
      await t.service.voidAdjustment(USER, id, voidDto());
      const afterFirst = t.snapshot();
      t.s.committed.length = 0;
      t.cache.invalidateVendorEntity.mockClear();

      await expect(t.service.voidAdjustment(USER, id, voidDto('Trying again by mistake'))).rejects.toBeInstanceOf(ConflictException);

      expectUntouched(t, afterFirst);
      expect(t.s.balance).toBe(1000);
    });

    it('blocks voiding a REVERSAL', async () => {
      const t = build();
      const id = t.seed();
      const { reversal } = await t.service.voidAdjustment(USER, id, voidDto());
      const after = t.snapshot();
      t.s.committed.length = 0;
      t.cache.invalidateVendorEntity.mockClear();

      const attempt = t.service.voidAdjustment(USER, reversal.id, voidDto('Undo the reversal please'));
      await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
      await expect(attempt).rejects.toThrow(/reversal cannot be voided/i);
      expectUntouched(t, after);
    });

    it.each([
      ['a TRANSFER_OUT leg', { kind: 'TRANSFER_OUT', direction: 'CREDIT' as const }],
      ['a TRANSFER_IN leg', { kind: 'TRANSFER_IN', direction: 'CHARGE' as const }],
      ['anything that belongs to a group', { kind: 'PENALTY', direction: 'CHARGE' as const, groupId: 'group-1' }],
    ])('blocks voiding %s on its own', async (_label, o) => {
      const t = build();
      const id = t.seed(o);
      const before = t.snapshot();
      await expect(t.service.voidAdjustment(USER, id, voidDto())).rejects.toThrow(/balance transfer/i);
      expectUntouched(t, before);
    });

    it('blocks voiding a credit that is linked to a staff penalty (Linked Penalty, owner-approved 2026-09-25)', async () => {
      const t = build();
      const id = t.seed({ kind: 'STAFF_FAULT_CREDIT', direction: 'CREDIT', linkedFromStaffLedgerEntryId: 'entry-001' });
      const before = t.snapshot();
      await expect(t.service.voidAdjustment(USER, id, voidDto())).rejects.toThrow(/linked to a staff penalty/i);
      expectUntouched(t, before);
    });

    it('skipLinkGuard lets an orchestrator (LinkedPenaltyService) void a linked credit via voidAdjustmentTx', async () => {
      const t = build();
      const id = t.seed({ kind: 'STAFF_FAULT_CREDIT', direction: 'CREDIT', linkedFromStaffLedgerEntryId: 'entry-001' });

      const result = await t.db.$transaction((tx: any) =>
        t.service.voidAdjustmentTx(tx, USER, id, REASON, { skipLinkGuard: true }),
      );

      expect(result.adjustment.status).toBe('VOIDED');
    });

    it('404s for an unknown id', async () => {
      const t = build();
      const before = t.snapshot();
      await expect(t.service.voidAdjustment(USER, 'nope', voidDto())).rejects.toBeInstanceOf(NotFoundException);
      expectUntouched(t, before);
    });

    it('404s for ANOTHER vendor\'s adjustment (no cross-tenant voiding)', async () => {
      const t = build();
      const id = t.seed({ vendorId: OTHER_VENDOR_ID });
      const before = t.snapshot();
      await expect(t.service.voidAdjustment(USER, id, voidDto())).rejects.toBeInstanceOf(NotFoundException);
      expectUntouched(t, before);
    });

    it('refuses an adjustment whose ledger row is missing', async () => {
      const t = build();
      const id = t.seed({ ledger: 'none' });
      const before = t.snapshot();
      await expect(t.service.voidAdjustment(USER, id, voidDto())).rejects.toBeInstanceOf(ConflictException);
      expectUntouched(t, before);
    });

    it('refuses an adjustment whose ledger row disagrees with its document (would compound corruption)', async () => {
      const t = build();
      const id = t.seed({ direction: 'CHARGE', amount: 500, ledger: 480 });
      const before = t.snapshot();
      await expect(t.service.voidAdjustment(USER, id, voidDto())).rejects.toThrow(/does not match/i);
      expectUntouched(t, before);
    });

    it('scopes every read AND the claim to the caller\'s vendor', async () => {
      const t = build();
      const id = t.seed();
      await t.service.voidAdjustment(USER, id, voidDto());
      const find = t.s.calls.find((c) => c.op === 'adjustment.findFirst')!;
      expect(find.args.where).toEqual({ id, vendorId: VENDOR_ID });
      const claim = t.s.calls.find((c) => c.op === 'adjustment.updateMany')!;
      expect(claim.args.where).toEqual({ id, vendorId: VENDOR_ID, status: 'POSTED' });
    });
  });

  // ── Reason ────────────────────────────────────────────────────────────────────
  describe('reason', () => {
    it.each([['missing', undefined], ['empty', ''], ['whitespace only', '      '], ['too short', 'oops']])(
      'is required — %s is a 400 before anything is read',
      async (_label, reason) => {
        const t = build();
        const id = t.seed();
        await expect(t.service.voidAdjustment(USER, id, { reason } as any)).rejects.toBeInstanceOf(BadRequestException);
        expect(t.s.calls.filter((c) => c.op === 'adjustment.findFirst')).toHaveLength(0);
        expect(t.db.$transaction).not.toHaveBeenCalled();
      },
    );
  });

  // ── Permissions ───────────────────────────────────────────────────────────────
  describe('permissions', () => {
    it('requires customer_financial_adjustments:void, checked before any read', async () => {
      const t = build([]);
      const id = t.seed();
      await expect(t.service.voidAdjustment(USER, id, voidDto())).rejects.toBeInstanceOf(ForbiddenException);
      expect(t.permissions.can).toHaveBeenCalledWith(USER.userId, P('void'));
      expect(t.s.calls).toEqual([]); // no lookup at all — nothing to probe
      expect(t.db.$transaction).not.toHaveBeenCalled();
    });

    it.each([['create'], ['create_credit'], ['transfer'], ['create_restricted'], ['view']])(
      'holding only %s is NOT enough to void',
      async (perm) => {
        const t = build([P(perm)]);
        const id = t.seed();
        const before = t.snapshot();
        await expect(t.service.voidAdjustment(USER, id, voidDto())).rejects.toBeInstanceOf(ForbiddenException);
        expect(t.snapshot()).toEqual(before);
      },
    );

    it('the legacy transactions:adjust permission grants nothing here', async () => {
      const t = build(['transactions:adjust']);
      const id = t.seed();
      await expect(t.service.voidAdjustment(USER, id, voidDto())).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('void alone is sufficient — it does not also need the original kind\'s posting permission', async () => {
      const t = build([P('void')]);
      const id = t.seed({ kind: 'DISCOUNT', direction: 'CREDIT', amount: 100 });
      await expect(t.service.voidAdjustment(USER, id, voidDto())).resolves.toMatchObject({ customerBalance: 1000 });
    });
  });

  // ── Rollback ──────────────────────────────────────────────────────────────────
  describe('rollback: a failure at ANY step restores the world', () => {
    it.each([
      ['the claim of the original', 'adjustment.updateMany'],
      ['creating the reversal document', 'adjustment.create'],
      ['creating the reversal ledger row', 'transaction.create'],
      ['the balance update', 'customer.update'],
      ['the FIRST audit row', 'auditLog.create'],
      ['the SECOND audit row', 'auditLog.create#2'],
      ['the final read-back (after every write)', 'adjustment.findUniqueOrThrow'],
    ])('failing at %s leaves balance, documents, ledger and audit exactly as before', async (_label, failOn) => {
      const t = build();
      const id = t.seed({ amount: 500 });
      const before = t.snapshot();
      t.s.failOn = failOn;

      await expect(t.service.voidAdjustment(USER, id, voidDto())).rejects.toThrow(/injected failure/);

      expect(t.snapshot()).toEqual(before); // deep: docs (still POSTED), ledger rows, audit, balance
      expect(t.s.adjustments.get(id).status).toBe('POSTED');
      expect(t.s.adjustments.get(id).voidedAt).toBeNull();
      expect(t.s.balance).toBe(1500);
      expect(t.consistent()).toBe(true);
      expect(t.s.committed).toEqual([]);
      expect(t.cache.invalidateVendorEntity).not.toHaveBeenCalled();
    });

    it('a reversal that already exists (unique reversalOfId) is a 409 and rolls the claim back', async () => {
      const t = build();
      const id = t.seed();
      t.seed({ kind: 'REVERSAL', direction: 'CREDIT', reversalOfId: id }); // corrupt state: POSTED original + a reversal
      const before = t.snapshot();

      await expect(t.service.voidAdjustment(USER, id, voidDto())).rejects.toBeInstanceOf(ConflictException);

      expect(t.snapshot()).toEqual(before);
      expect(t.s.adjustments.get(id).status).toBe('POSTED');
    });
  });

  // ── Concurrency ───────────────────────────────────────────────────────────────
  describe('concurrency: the claim is the double-void guard', () => {
    it('two voids racing from the same stale read: exactly one wins, one 409, balance restored ONCE', async () => {
      const t = build();
      const id = t.seed({ amount: 500 });
      // Both requests read the adjustment as POSTED before either commits.
      const stale = structuredClone(await t.db.customerFinancialAdjustment.findFirst({ where: { id, vendorId: VENDOR_ID }, include: { transaction: true } }));
      t.db.customerFinancialAdjustment.findFirst = async () => structuredClone(stale);

      const results = await Promise.allSettled([
        t.service.voidAdjustment(USER, id, voidDto('First void request')),
        t.service.voidAdjustment(USER, id, voidDto('Second void request')),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(ConflictException);

      expect(t.s.balance).toBe(1000); // restored exactly once — not 500
      expect([...t.s.adjustments.values()].filter((d) => d.kind === 'REVERSAL')).toHaveLength(1);
      expect(t.s.transactions.size).toBe(2);
      expect(t.s.audit).toHaveLength(2);
      expect(t.consistent()).toBe(true);
    });

    it('a lost race creates no reversal, ledger row or audit either way it is caught', async () => {
      const t = build();
      const id = t.seed({ amount: 500 });
      // Someone else voids it first (committed, real state)...
      t.s.adjustments.get(id).status = 'VOIDED';
      const before = t.snapshot();

      await expect(t.service.voidAdjustment(USER, id, voidDto())).rejects.toBeInstanceOf(ConflictException);

      expect(t.snapshot()).toEqual(before);
      const writes = t.s.calls.map((c) => c.op).filter((op) => /create|update/.test(op));
      // The load now happens INSIDE the transaction (voidAdjustmentTx, composable
      // for LinkedPenaltyService) via the SAME tx client the claim would use, so a
      // request that's already stale-to-the-point-of-committed-VOIDED is caught by
      // the "already voided" guard before ever attempting the claim — no wasted
      // write. A genuine race (both sides reading POSTED before either commits)
      // still resolves correctly via the updateMany claim under real Postgres row
      // locking — see the "two voids racing" test above.
      expect(writes).toEqual([]);
    });
  });

  // ── Cache ─────────────────────────────────────────────────────────────────────
  describe('cache invalidation', () => {
    it('runs once AFTER commit with the same fan-out as create', async () => {
      const t = build();
      const id = t.seed();
      await t.service.voidAdjustment(USER, id, voidDto());
      expect(t.cache.invalidateVendorEntity).toHaveBeenCalledTimes(1);
      expect(t.cache.invalidateOverview).toHaveBeenCalledWith(VENDOR_ID);
      expect(t.cache.invalidateAnalytics).toHaveBeenCalledWith(VENDOR_ID);
      expect(t.cache.invalidateCustomerWallets).toHaveBeenCalledWith(VENDOR_ID, CUSTOMER_ID);
    });

    it('a cache failure after commit does not fail the (already committed) void', async () => {
      const t = build();
      const id = t.seed();
      t.cache.invalidateOverview.mockRejectedValueOnce(new Error('redis down'));
      await expect(t.service.voidAdjustment(USER, id, voidDto())).resolves.toMatchObject({ customerBalance: 1000 });
      expect(t.s.committed.length).toBeGreaterThan(0);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2D — restricted kinds against the STATEFUL ledger: real round trip + real rollback
// ══════════════════════════════════════════════════════════════════════════════
describe('restricted kinds (WRITE_OFF, CORRECTION) — stateful round trip, cap and rollback', () => {
  const GRANTED = [P('create_restricted'), P('void')];
  const STAFF_TITLE = 'INTERNAL: staff-only wording';
  let seq = 0;
  const post = (t: ReturnType<typeof build>, kind: string, extra: Record<string, unknown> = {}) =>
    t.service.create(USER, {
      customerId: CUSTOMER_ID,
      kind,
      amount: 400,
      title: STAFF_TITLE,
      internalNote: 'Approved by the owner',
      idempotencyKey: `restricted-${kind}-${++seq}-abcdefgh`,
      ...extra,
    } as any);

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout'] }).setSystemTime(NOW);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('post via create(), then void: balance restored to the cent, wording stays neutral', () => {
    it.each([
      ['WRITE_OFF', {}, 600],
      ['CORRECTION', { direction: 'CHARGE' }, 1400],
      ['CORRECTION', { direction: 'CREDIT' }, 600],
    ])('%s %j → balance %p after posting', async (kind, extra, afterPost) => {
      const t = build(GRANTED, 1000);
      const posted = await post(t, kind, extra);
      expect(t.s.balance).toBe(afterPost);

      const voided = await t.service.voidAdjustment(USER, posted.adjustment.id, voidDto());

      expect(t.s.balance).toBe(1000);
      expect(voided.reversal.customerVisibility).toBe('SUMMARIZED'); // voiding must not un-hide it
      expect(voided.reversalTransaction.description).toBe('Account adjustment reversal');
      expect(voided.reversalTransaction.amount + posted.transaction.amount).toBe(0);
      expect(t.consistent()).toBe(true);

      // The staff-only wording never reached ANY ledger row (the portal returns raw rows).
      for (const row of t.s.transactions.values()) {
        expect(JSON.stringify(row)).not.toContain('INTERNAL');
        expect(JSON.stringify(row)).not.toContain('Approved by the owner');
      }
    });
  });

  describe('write-off cap: a breach rolls back with REAL state', () => {
    it('refusing a write-off larger than the balance leaves balance, documents, ledger and audit untouched', async () => {
      const t = build(GRANTED, 200);
      const before = t.snapshot();

      await expect(post(t, 'WRITE_OFF', { amount: 500 })).rejects.toThrow(/outstanding: 200\.00/);

      expect(t.snapshot()).toEqual(before);
      expect(t.s.balance).toBe(200);
      expect(t.s.adjustments.size).toBe(0);
      expect(t.s.transactions.size).toBe(0);
      expect(t.s.audit).toHaveLength(0);
      expect(t.s.committed).toEqual([]);
      expect(t.cache.invalidateVendorEntity).not.toHaveBeenCalled();
      expect(t.consistent()).toBe(true);
    });

    it('a write-off of exactly the outstanding balance clears it', async () => {
      const t = build(GRANTED, 500);
      await post(t, 'WRITE_OFF', { amount: 500 });
      expect(t.s.balance).toBe(0);
      expect(t.consistent()).toBe(true);
    });

    it('two write-offs racing for the same debt: only what is actually owed is written off', async () => {
      const t = build(GRANTED, 500);

      const results = await Promise.allSettled([
        post(t, 'WRITE_OFF', { amount: 400, idempotencyKey: 'race-writeoff-one-1234' }),
        post(t, 'WRITE_OFF', { amount: 400, idempotencyKey: 'race-writeoff-two-5678' }),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(BadRequestException);

      expect(t.s.balance).toBe(100); // 500 owed − ONE 400 write-off; never negative
      expect([...t.s.adjustments.values()].filter((d) => d.kind === 'WRITE_OFF')).toHaveLength(1);
      expect(t.consistent()).toBe(true);
    });

    it('re-instating the debt by voiding a write-off is allowed and exact', async () => {
      const t = build(GRANTED, 500);
      const posted = await post(t, 'WRITE_OFF', { amount: 500 });
      expect(t.s.balance).toBe(0);
      await t.service.voidAdjustment(USER, posted.adjustment.id, voidDto('Customer paid after all'));
      expect(t.s.balance).toBe(500);
      expect(t.consistent()).toBe(true);
    });
  });
});
