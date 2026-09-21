import { ADJUSTMENT_KIND_POLICY, STANDALONE_ADJUSTMENT_KINDS } from '@water-supply-crm/types';
import type { PostableAdjustmentKind } from './api/customer-adjustments.api';
import {
  balanceAfter,
  buildCreatePayload,
  dateBounds,
  describeBalance,
  emptyCreateForm,
  newIdempotencyKey,
  parseAmount,
  resolveFormDirection,
  validateCreateForm,
  type CreateFormState,
} from './create-adjustment';

const TODAY = '2026-09-20';
const POSTABLE = STANDALONE_ADJUSTMENT_KINDS as readonly PostableAdjustmentKind[];

/** A valid form for `kind`, overridable per test. */
const form = (kind: PostableAdjustmentKind, o: Partial<CreateFormState> = {}): CreateFormState => ({
  ...emptyCreateForm(kind, TODAY),
  direction: kind === 'CORRECTION' ? 'CHARGE' : '',
  amount: '500',
  title: 'Late payment',
  internalNote: 'Reason on file',
  ...o,
});

describe('parseAmount — positive, at most 2 decimals (mirrors the backend)', () => {
  it.each([
    ['500', 500],
    ['0.01', 0.01],
    ['250.5', 250.5],
    ['1250.75', 1250.75],
    ['1.1', 1.1], // 1.1 * 100 is inexact in binary floating point
    ['  12  ', 12],
  ])('accepts %p', (raw, expected) => expect(parseAmount(raw)).toBe(expected));

  it.each([[''], ['   '], ['0'], ['-5'], ['abc'], ['1.005'], ['10.999'], ['0.001'], ['Infinity'], ['NaN']])(
    'rejects %p',
    (raw) => expect(parseAmount(raw)).toBeNull(),
  );
});

describe('resolveFormDirection — the backend owns the direction', () => {
  it('is fixed by the kind policy for every kind except CORRECTION, whatever the form holds', () => {
    for (const kind of POSTABLE.filter((k) => k !== 'CORRECTION')) {
      const fixed = ADJUSTMENT_KIND_POLICY[kind].direction;
      // even a stale/forged `direction` in the form cannot change it
      expect(resolveFormDirection({ kind, direction: fixed === 'CHARGE' ? 'CREDIT' : 'CHARGE' })).toBe(fixed);
    }
  });

  it('charge kinds are CHARGE and credit kinds / write-off are CREDIT', () => {
    expect(['SERVICE_FEE', 'PENALTY', 'OTHER_CHARGE'].map((kind) => resolveFormDirection({ kind: kind as PostableAdjustmentKind, direction: '' }))).toEqual(['CHARGE', 'CHARGE', 'CHARGE']);
    expect(['DISCOUNT', 'GOODWILL_CREDIT', 'OTHER_CREDIT', 'WRITE_OFF'].map((kind) => resolveFormDirection({ kind: kind as PostableAdjustmentKind, direction: '' }))).toEqual(['CREDIT', 'CREDIT', 'CREDIT', 'CREDIT']);
  });

  it('CORRECTION is the only kind that takes the user’s choice — and is undecided until they make one', () => {
    expect(resolveFormDirection({ kind: 'CORRECTION', direction: '' })).toBeNull();
    expect(resolveFormDirection({ kind: 'CORRECTION', direction: 'CHARGE' })).toBe('CHARGE');
    expect(resolveFormDirection({ kind: 'CORRECTION', direction: 'CREDIT' })).toBe('CREDIT');
    expect(resolveFormDirection({ kind: '', direction: 'CHARGE' })).toBeNull();
  });
});

describe('dateBounds — the current month up to today (Karachi)', () => {
  it('runs from the 1st of the month to today', () => {
    expect(dateBounds('2026-09-20')).toEqual({ min: '2026-09-01', max: '2026-09-20' });
    expect(dateBounds('2026-03-01')).toEqual({ min: '2026-03-01', max: '2026-03-01' });
    expect(dateBounds('2026-12-31')).toEqual({ min: '2026-12-01', max: '2026-12-31' });
  });
});

describe('validateCreateForm', () => {
  it('accepts a complete form for every postable kind', () => {
    for (const kind of POSTABLE) expect(validateCreateForm(form(kind), TODAY)).toEqual({});
  });

  it('requires an internal note exactly where the kind policy says so (credits, write-off, correction)', () => {
    for (const kind of POSTABLE) {
      const errors = validateCreateForm(form(kind, { internalNote: '   ' }), TODAY);
      if (ADJUSTMENT_KIND_POLICY[kind].requiresInternalNote) expect(errors.internalNote).toMatch(/required/i);
      else expect(errors.internalNote).toBeUndefined();
    }
    // sanity: the policy really does split them (charges optional, the rest required)
    expect(ADJUSTMENT_KIND_POLICY.SERVICE_FEE.requiresInternalNote).toBe(false);
    expect(ADJUSTMENT_KIND_POLICY.DISCOUNT.requiresInternalNote).toBe(true);
    expect(ADJUSTMENT_KIND_POLICY.WRITE_OFF.requiresInternalNote).toBe(true);
  });

  it('requires a direction for CORRECTION only', () => {
    expect(validateCreateForm(form('CORRECTION', { direction: '' }), TODAY).direction).toBeDefined();
    expect(validateCreateForm(form('CORRECTION', { direction: 'CREDIT' }), TODAY).direction).toBeUndefined();
    expect(validateCreateForm(form('PENALTY'), TODAY).direction).toBeUndefined();
  });

  it('requires a valid amount and a title, and enforces the backend length limits', () => {
    expect(validateCreateForm(form('PENALTY', { amount: '' }), TODAY).amount).toBeDefined();
    expect(validateCreateForm(form('PENALTY', { amount: '0' }), TODAY).amount).toBeDefined();
    expect(validateCreateForm(form('PENALTY', { amount: '1.234' }), TODAY).amount).toMatch(/2 decimal/);
    expect(validateCreateForm(form('PENALTY', { title: '   ' }), TODAY).title).toBeDefined();
    expect(validateCreateForm(form('PENALTY', { title: 'x'.repeat(121) }), TODAY).title).toMatch(/120/);
    expect(validateCreateForm(form('PENALTY', { title: 'x'.repeat(120) }), TODAY)).toEqual({});
    expect(validateCreateForm(form('PENALTY', { internalNote: 'x'.repeat(1001) }), TODAY).internalNote).toMatch(/1000/);
  });

  it('accepts today and any earlier day this month; refuses the future and previous months', () => {
    for (const day of ['2026-09-20', '2026-09-19', '2026-09-01']) {
      expect(validateCreateForm(form('PENALTY', { effectiveDate: day }), TODAY).effectiveDate).toBeUndefined();
    }
    expect(validateCreateForm(form('PENALTY', { effectiveDate: '2026-09-21' }), TODAY).effectiveDate).toMatch(/future/);
    expect(validateCreateForm(form('PENALTY', { effectiveDate: '2026-08-31' }), TODAY).effectiveDate).toMatch(/current month/);
    expect(validateCreateForm(form('PENALTY', { effectiveDate: '' }), TODAY).effectiveDate).toBeDefined();
  });

  it('reports every problem at once', () => {
    const errors = validateCreateForm(form('DISCOUNT', { amount: '', title: '', internalNote: '', effectiveDate: '2026-01-01' }), TODAY);
    expect(Object.keys(errors).sort()).toEqual(['amount', 'effectiveDate', 'internalNote', 'title']);
  });

  it('asks for a type when none is chosen', () => {
    expect(validateCreateForm(emptyCreateForm('', TODAY), TODAY)).toEqual({ kind: 'Choose a type.' });
  });
});

describe('buildCreatePayload', () => {
  it('NEVER sends a direction for a fixed kind — the backend decides it', () => {
    for (const kind of POSTABLE.filter((k) => k !== 'CORRECTION')) {
      // even with a stray direction sitting in the form state
      const payload = buildCreatePayload('c1', form(kind, { direction: 'CREDIT' }), 'key-12345678', TODAY);
      expect('direction' in payload).toBe(false);
    }
  });

  it('sends the chosen direction for CORRECTION (the one kind that needs it)', () => {
    expect(buildCreatePayload('c1', form('CORRECTION', { direction: 'CREDIT' }), 'key-12345678', TODAY).direction).toBe('CREDIT');
    expect(buildCreatePayload('c1', form('CORRECTION', { direction: 'CHARGE' }), 'key-12345678', TODAY).direction).toBe('CHARGE');
  });

  it('trims text, parses the amount, and omits empty optional fields', () => {
    const payload = buildCreatePayload(
      'cust-1',
      form('SERVICE_FEE', { amount: ' 250.50 ', title: '  Installation  ', internalNote: '   ', referenceNo: '' }),
      'key-12345678',
      TODAY,
    );
    expect(payload).toEqual({
      customerId: 'cust-1',
      kind: 'SERVICE_FEE',
      amount: 250.5,
      title: 'Installation',
      internalNote: undefined,
      referenceNo: undefined,
      effectiveDate: undefined,
      idempotencyKey: 'key-12345678',
    });
  });

  it('omits the date for today (backend stamps the real moment) and sends an earlier day this month', () => {
    expect(buildCreatePayload('c1', form('PENALTY', { effectiveDate: TODAY }), 'key-12345678', TODAY).effectiveDate).toBeUndefined();
    expect(buildCreatePayload('c1', form('PENALTY', { effectiveDate: '2026-09-05' }), 'key-12345678', TODAY).effectiveDate).toBe('2026-09-05');
  });

  it('keeps the note and reference when given', () => {
    const payload = buildCreatePayload('c1', form('DISCOUNT', { internalNote: ' Loyal customer ', referenceNo: ' INV-9 ' }), 'key-12345678', TODAY);
    expect(payload).toMatchObject({ internalNote: 'Loyal customer', referenceNo: 'INV-9' });
  });

  it('refuses to build from an invalid form (a programming error, not a user error)', () => {
    expect(() => buildCreatePayload('c1', emptyCreateForm('', TODAY), 'k', TODAY)).toThrow();
    expect(() => buildCreatePayload('c1', form('PENALTY', { amount: '1.234' }), 'k', TODAY)).toThrow();
  });
});

describe('balance preview', () => {
  it('a charge raises what the customer owes, a credit lowers it', () => {
    expect(balanceAfter(1000, 'CHARGE', 250)).toBe(1250);
    expect(balanceAfter(1000, 'CREDIT', 250)).toBe(750);
    expect(balanceAfter(100, 'CREDIT', 250)).toBe(-150); // → in credit
    expect(balanceAfter(0.1, 'CHARGE', 0.2)).toBe(0.3); // no float drift
  });

  it('describes a balance in words', () => {
    expect(describeBalance(1250)).toBe('₨ 1,250 owed');
    expect(describeBalance(-150.5)).toBe('₨ 150.5 credit');
    expect(describeBalance(0)).toBe('₨ 0 (settled)');
    expect(describeBalance(0.004)).toBe('₨ 0 (settled)');
  });
});

describe('newIdempotencyKey', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  afterEach(() => {
    if (original) Object.defineProperty(globalThis, 'crypto', original);
  });

  it('is unique per call and long enough for the backend (8–100 characters)', () => {
    const keys = new Set(Array.from({ length: 50 }, () => newIdempotencyKey()));
    expect(keys.size).toBe(50);
    for (const k of keys) expect(k.length).toBeGreaterThanOrEqual(8);
    for (const k of keys) expect(k.length).toBeLessThanOrEqual(100);
  });

  it('still works where crypto.randomUUID is unavailable (insecure context)', () => {
    Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true });
    const a = newIdempotencyKey();
    const b = newIdempotencyKey();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(8);
    expect(a.length).toBeLessThanOrEqual(100);
  });
});
