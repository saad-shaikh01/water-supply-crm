import { BadRequestException } from '@nestjs/common';
import { VEHICLE_CHECKLIST_ITEMS } from '@water-supply-crm/types';
import { normalizeChecklistResults, hasCriticalFailure } from './fleet-checklist.util';

function allPassing() {
  return VEHICLE_CHECKLIST_ITEMS.map((item) => ({ key: item.key, passed: true }));
}

describe('normalizeChecklistResults', () => {
  it('normalizes a complete, all-passing submission with no critical failure', () => {
    const normalized = normalizeChecklistResults(allPassing());
    expect(normalized).toHaveLength(VEHICLE_CHECKLIST_ITEMS.length);
    expect(hasCriticalFailure(normalized)).toBe(false);
  });

  it('throws if the submission is missing an item', () => {
    const incomplete = allPassing().slice(1);
    expect(() => normalizeChecklistResults(incomplete)).toThrow(BadRequestException);
  });

  it('always derives label/isCritical from the server catalog, ignoring anything the client sends', () => {
    const tampered = allPassing().map((r) => ({ ...r, label: 'HACKED', isCritical: false }) as any);
    const normalized = normalizeChecklistResults(tampered);
    const brakes = normalized.find((r) => r.key === 'BRAKES');
    expect(brakes?.isCritical).toBe(true);
    expect(brakes?.label).not.toBe('HACKED');
  });

  it('flags a critical failure only when a critical item is marked not-passed', () => {
    const withNonCriticalFailure = allPassing().map((r) => (r.key === 'HORN' ? { ...r, passed: false } : r));
    expect(hasCriticalFailure(normalizeChecklistResults(withNonCriticalFailure))).toBe(false);

    const withCriticalFailure = allPassing().map((r) => (r.key === 'BRAKES' ? { ...r, passed: false } : r));
    expect(hasCriticalFailure(normalizeChecklistResults(withCriticalFailure))).toBe(true);
  });
});
