import { ADJUSTMENT_KIND_POLICY, ADJUSTMENT_KINDS } from '@water-supply-crm/types';
import type { CustomerAdjustment } from './api/customer-adjustments.api';
import { isVoidable, postableKindsFor } from './permissions';

// permissions.ts imports the app's permission hook (network/cookies) — the pure helpers under
// test never call it.
jest.mock('../authz/hooks/use-permissions', () => ({ usePermissions: jest.fn() }));

const P = (a: string) => `customer_financial_adjustments:${a}`;
const canWith = (...granted: string[]) => (permission: string) => granted.includes(permission);

describe('postableKindsFor — kinds offered follow the user’s permissions', () => {
  it('`create` alone → only the three charge kinds', () => {
    expect(postableKindsFor(canWith(P('create')) as never)).toEqual(['SERVICE_FEE', 'PENALTY', 'OTHER_CHARGE']);
  });

  it('`create_credit` alone → only the three credit kinds', () => {
    expect(postableKindsFor(canWith(P('create_credit')) as never)).toEqual(['DISCOUNT', 'GOODWILL_CREDIT', 'OTHER_CREDIT']);
  });

  it('`create_restricted` alone → only write-off and correction', () => {
    expect(postableKindsFor(canWith(P('create_restricted')) as never)).toEqual(['WRITE_OFF', 'CORRECTION']);
  });

  it('all three → all 8 standalone kinds, in the policy’s order', () => {
    const all = postableKindsFor(canWith(P('create'), P('create_credit'), P('create_restricted')) as never);
    expect(all).toHaveLength(8);
    expect(all).toEqual(ADJUSTMENT_KINDS.filter((k) => ADJUSTMENT_KIND_POLICY[k].creation === 'STANDALONE'));
  });

  it('never offers transfer legs or REVERSAL — even to someone holding `transfer` / `void`', () => {
    const kinds = postableKindsFor(canWith(P('transfer'), P('void'), P('view'), P('create'), P('create_credit'), P('create_restricted')) as never);
    expect(kinds).not.toContain('TRANSFER_OUT');
    expect(kinds).not.toContain('TRANSFER_IN');
    expect(kinds).not.toContain('REVERSAL');
  });

  it('holding only view / void / transfer / the legacy adjust permission → nothing to post', () => {
    expect(postableKindsFor(canWith(P('view'), P('void'), P('transfer'), 'transactions:adjust') as never)).toEqual([]);
    expect(postableKindsFor(canWith() as never)).toEqual([]);
  });
});

describe('isVoidable — mirrors what the backend would accept', () => {
  const row = (o: Partial<Pick<CustomerAdjustment, 'status' | 'kind' | 'groupId'>> = {}) =>
    ({ status: 'POSTED', kind: 'PENALTY', groupId: null, ...o }) as Pick<CustomerAdjustment, 'status' | 'kind' | 'groupId'>;

  it('a POSTED standalone adjustment can be voided — every standalone kind', () => {
    for (const kind of ADJUSTMENT_KINDS.filter((k) => ADJUSTMENT_KIND_POLICY[k].creation === 'STANDALONE')) {
      expect(isVoidable(row({ kind }))).toBe(true);
    }
  });

  it('an already-VOIDED adjustment cannot', () => {
    expect(isVoidable(row({ status: 'VOIDED' }))).toBe(false);
  });

  it('a REVERSAL cannot (to undo a void, post a new adjustment)', () => {
    expect(isVoidable(row({ kind: 'REVERSAL' }))).toBe(false);
  });

  it('a transfer leg cannot (a transfer is voided as a group) — by kind or by group', () => {
    expect(isVoidable(row({ kind: 'TRANSFER_OUT', groupId: 'grp-1' }))).toBe(false);
    expect(isVoidable(row({ kind: 'TRANSFER_IN', groupId: 'grp-1' }))).toBe(false);
    expect(isVoidable(row({ kind: 'TRANSFER_OUT', groupId: null }))).toBe(false); // by kind alone
    expect(isVoidable(row({ kind: 'PENALTY', groupId: 'grp-1' }))).toBe(false); // by group alone
  });
});
