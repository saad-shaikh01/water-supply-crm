import {
  AdjustmentDirection as PrismaDirection,
  AdjustmentGroupType as PrismaGroupType,
  AdjustmentKind as PrismaKind,
  AdjustmentStatus as PrismaStatus,
  AdjustmentVisibility as PrismaVisibility,
} from '@prisma/client';
import { isPermission } from '../../../authz/src/lib/permissions';
import {
  ADJUSTMENT_DIRECTIONS,
  ADJUSTMENT_GROUP_TYPES,
  ADJUSTMENT_KINDS,
  ADJUSTMENT_KIND_POLICY,
  ADJUSTMENT_STATUSES,
  ADJUSTMENT_SUMMARIZED_LABEL,
  ADJUSTMENT_VISIBILITIES,
  STANDALONE_ADJUSTMENT_KINDS,
  adjustmentKindPermission,
  type AdjustmentKind,
} from './customer-financial-adjustment';

const sorted = (xs: readonly string[]) => [...xs].sort();

describe('mirrored unions stay in sync with the Prisma enums', () => {
  // The unions here are hand-mirrored (same convention as fleet.ts). If a Prisma enum
  // gains/loses a value without this file following — or vice versa — these fail.
  it.each([
    ['AdjustmentKind', ADJUSTMENT_KINDS, PrismaKind],
    ['AdjustmentDirection', ADJUSTMENT_DIRECTIONS, PrismaDirection],
    ['AdjustmentStatus', ADJUSTMENT_STATUSES, PrismaStatus],
    ['AdjustmentVisibility', ADJUSTMENT_VISIBILITIES, PrismaVisibility],
    ['AdjustmentGroupType', ADJUSTMENT_GROUP_TYPES, PrismaGroupType],
  ] as const)('%s', (_name, mirrored, prismaEnum) => {
    expect(sorted(mirrored)).toEqual(sorted(Object.values(prismaEnum)));
  });
});

describe('kind policy table', () => {
  it('has exactly one policy per kind', () => {
    expect(sorted(Object.keys(ADJUSTMENT_KIND_POLICY))).toEqual(sorted(ADJUSTMENT_KINDS));
  });

  it('every permission a kind needs is a real catalog permission', () => {
    for (const kind of ADJUSTMENT_KINDS) {
      const perm = adjustmentKindPermission(kind);
      if (perm === null) continue;
      expect(isPermission(perm)).toBe(true);
    }
  });

  it('resolves the full permission string per kind', () => {
    expect(adjustmentKindPermission('PENALTY')).toBe('customer_financial_adjustments:create');
    expect(adjustmentKindPermission('DISCOUNT')).toBe('customer_financial_adjustments:create_credit');
    expect(adjustmentKindPermission('TRANSFER_IN')).toBe('customer_financial_adjustments:transfer');
    expect(adjustmentKindPermission('WRITE_OFF')).toBe('customer_financial_adjustments:create_restricted');
    expect(adjustmentKindPermission('REVERSAL')).toBeNull();
  });

  it('charges need `create`, credits `create_credit`, transfers `transfer`, write-off/correction `create_restricted`', () => {
    const byPerm = (action: string) =>
      ADJUSTMENT_KINDS.filter((k) => ADJUSTMENT_KIND_POLICY[k].permission === action);
    expect(sorted(byPerm('create'))).toEqual(['OTHER_CHARGE', 'PENALTY', 'SERVICE_FEE']);
    expect(sorted(byPerm('create_credit'))).toEqual(['DISCOUNT', 'GOODWILL_CREDIT', 'OTHER_CREDIT']);
    expect(sorted(byPerm('transfer'))).toEqual(['TRANSFER_IN', 'TRANSFER_OUT']);
    expect(sorted(byPerm('create_restricted'))).toEqual(['CORRECTION', 'WRITE_OFF']);
  });

  it('fixes direction per kind; CORRECTION is chosen by staff, REVERSAL mirrors the original', () => {
    const dir = (k: AdjustmentKind) => ADJUSTMENT_KIND_POLICY[k].direction;
    for (const k of ['SERVICE_FEE', 'PENALTY', 'OTHER_CHARGE', 'TRANSFER_IN'] as const) expect(dir(k)).toBe('CHARGE');
    for (const k of ['DISCOUNT', 'GOODWILL_CREDIT', 'OTHER_CREDIT', 'TRANSFER_OUT', 'WRITE_OFF'] as const)
      expect(dir(k)).toBe('CREDIT');
    expect(dir('CORRECTION')).toBe('EITHER');
    expect(dir('REVERSAL')).toBe('DERIVED');
  });

  it('INVARIANT: a CHARGE is never less than ITEMIZED — the customer is always told what they were billed for', () => {
    for (const k of ADJUSTMENT_KINDS) {
      const p = ADJUSTMENT_KIND_POLICY[k];
      if (p.direction === 'CHARGE') expect(p.visibility).toBe('ITEMIZED');
    }
  });

  it('only the internal kinds are SUMMARIZED; transfers are always ITEMIZED; REVERSAL derives', () => {
    const summarized = ADJUSTMENT_KINDS.filter((k) => ADJUSTMENT_KIND_POLICY[k].visibility === 'SUMMARIZED');
    expect(sorted(summarized)).toEqual(['CORRECTION', 'WRITE_OFF']);
    expect(ADJUSTMENT_KIND_POLICY.TRANSFER_OUT.visibility).toBe('ITEMIZED');
    expect(ADJUSTMENT_KIND_POLICY.TRANSFER_IN.visibility).toBe('ITEMIZED');
    expect(ADJUSTMENT_KIND_POLICY.REVERSAL.visibility).toBe('DERIVED');
  });

  it('requires an internal note for every credit, write-off and correction — but not charges, transfer legs or reversals', () => {
    const noteRequired = ADJUSTMENT_KINDS.filter((k) => ADJUSTMENT_KIND_POLICY[k].requiresInternalNote);
    expect(sorted(noteRequired)).toEqual(
      ['CORRECTION', 'DISCOUNT', 'GOODWILL_CREDIT', 'OTHER_CREDIT', 'WRITE_OFF'],
    );
  });

  it('creation paths: 8 standalone kinds, the two transfer legs, and system-only REVERSAL', () => {
    expect(sorted(STANDALONE_ADJUSTMENT_KINDS)).toEqual(
      ['CORRECTION', 'DISCOUNT', 'GOODWILL_CREDIT', 'OTHER_CHARGE', 'OTHER_CREDIT', 'PENALTY', 'SERVICE_FEE', 'WRITE_OFF'],
    );
    const via = (path: string) => ADJUSTMENT_KINDS.filter((k) => ADJUSTMENT_KIND_POLICY[k].creation === path);
    expect(sorted(via('TRANSFER'))).toEqual(['TRANSFER_IN', 'TRANSFER_OUT']);
    expect(via('SYSTEM')).toEqual(['REVERSAL']);
  });

  it('a kind that needs no permission is exactly the system-only one', () => {
    for (const k of ADJUSTMENT_KINDS) {
      const p = ADJUSTMENT_KIND_POLICY[k];
      expect(p.permission === null).toBe(p.creation === 'SYSTEM');
    }
  });

  it('exposes the neutral customer-facing label for SUMMARIZED rows', () => {
    expect(ADJUSTMENT_SUMMARIZED_LABEL).toBe('Account adjustment');
  });
});
