import type { VehicleMaintenanceUrgency } from '@water-supply-crm/types';

/**
 * "Whichever comes first" maintenance due-calc (plan doc §7.3/§7.4/§1 research).
 * Pure function — no Prisma/service dependencies — so it's directly unit-testable.
 *
 * Thresholds are Phase 1 fixed constants (not per-vendor config, matching the
 * plan's "no over-engineering" instruction — configurable thresholds are not
 * called for in Phase 1's scope).
 */

export const DUE_KM_THRESHOLD = 300;
export const DUE_DAYS_THRESHOLD = 14;
export const UPCOMING_KM_THRESHOLD = 1000;
export const UPCOMING_DAYS_THRESHOLD = 30;

export interface MaintenanceDueCalcInput {
  intervalKm: number | null;
  intervalDays: number | null;
  /** Odometer at the last logged service, or null if never serviced (baseline 0). */
  lastServiceOdometer: number | null;
  /** Date of the last logged service, or null if never serviced (baseline = vehicle onboarding date). */
  lastServiceDate: Date | null;
  currentOdometer: number;
  /** Baseline date to project from when lastServiceDate is null (vehicle's onboarding date). */
  baselineDate: Date;
  now?: Date;
}

export interface MaintenanceDueCalcResult {
  dueAtOdometer: number | null;
  dueAtDate: Date | null;
  kmRemaining: number | null;
  daysRemaining: number | null;
  urgency: VehicleMaintenanceUrgency;
}

export function computeMaintenanceStatus(input: MaintenanceDueCalcInput): MaintenanceDueCalcResult {
  const now = input.now ?? new Date();
  const sinceOdometer = input.lastServiceOdometer ?? 0;
  const sinceDate = input.lastServiceDate ?? input.baselineDate;

  const dueAtOdometer = input.intervalKm != null ? sinceOdometer + input.intervalKm : null;
  const dueAtDate =
    input.intervalDays != null ? new Date(sinceDate.getTime() + input.intervalDays * 24 * 60 * 60 * 1000) : null;

  const kmRemaining = dueAtOdometer != null ? dueAtOdometer - input.currentOdometer : null;
  const daysRemaining =
    dueAtDate != null ? Math.floor((dueAtDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)) : null;

  let urgency: VehicleMaintenanceUrgency = 'OK';
  const isOverdue = (kmRemaining != null && kmRemaining <= 0) || (daysRemaining != null && daysRemaining <= 0);
  const isDue =
    (kmRemaining != null && kmRemaining <= DUE_KM_THRESHOLD) ||
    (daysRemaining != null && daysRemaining <= DUE_DAYS_THRESHOLD);
  const isUpcoming =
    (kmRemaining != null && kmRemaining <= UPCOMING_KM_THRESHOLD) ||
    (daysRemaining != null && daysRemaining <= UPCOMING_DAYS_THRESHOLD);

  if (isOverdue) urgency = 'OVERDUE';
  else if (isDue) urgency = 'DUE';
  else if (isUpcoming) urgency = 'UPCOMING';

  return { dueAtOdometer, dueAtDate, kmRemaining, daysRemaining, urgency };
}
