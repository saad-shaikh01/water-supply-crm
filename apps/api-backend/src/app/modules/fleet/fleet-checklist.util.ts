import { BadRequestException } from '@nestjs/common';
import { VEHICLE_CHECKLIST_ITEMS, type ChecklistItemResult } from '@water-supply-crm/types';

export interface ChecklistItemInput {
  key: string;
  passed: boolean;
  note?: string;
}

/**
 * Server-side checklist normalization — label/isCritical always come from
 * VEHICLE_CHECKLIST_ITEMS (the shared Phase 1 fixed checklist), never trusted
 * from the client, so a tampered/stale client payload can never misreport a
 * critical item as non-critical. Throws if the submission is incomplete.
 */
export function normalizeChecklistResults(input: ChecklistItemInput[]): ChecklistItemResult[] {
  const byKey = new Map(input.map((r) => [r.key, r]));
  return VEHICLE_CHECKLIST_ITEMS.map((def) => {
    const submitted = byKey.get(def.key);
    if (!submitted) {
      throw new BadRequestException(`Missing checklist result for "${def.label}".`);
    }
    return {
      key: def.key,
      label: def.label,
      isCritical: def.isCritical,
      passed: submitted.passed,
      note: submitted.note,
    };
  });
}

export function hasCriticalFailure(results: ChecklistItemResult[]): boolean {
  return results.some((r) => r.isCritical && !r.passed);
}
