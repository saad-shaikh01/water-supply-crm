/**
 * Fleet Operations & Vehicle Intelligence — Phase 1 (docs/features/fleet-operations-vehicle-intelligence.md).
 *
 * Mirrored enum unions (kept in sync with the Prisma enums by hand, same convention
 * as CrewCashCategory in api-responses.ts) plus the fixed Phase 1 checklist/interval
 * config. Phase 1 ships a single hardcoded checklist and a single hardcoded default
 * interval table — configurable per-vendor templates are explicitly Phase 2
 * (§16 of the plan doc), so this file is the one place both apps read from.
 */

export type VehicleFuelType = 'PETROL' | 'DIESEL' | 'CNG' | 'HYBRID' | 'ELECTRIC';

export type VehicleOwnershipType = 'OWNED' | 'LEASED' | 'RENTED' | 'FINANCED';

/** Distinct from Van.isActive (retired) — see plan doc §10 Rule 9. */
export type VehicleOperationalStatus = 'ACTIVE' | 'IN_MAINTENANCE' | 'RETIRED';

export type VehicleDocumentType =
  | 'REGISTRATION'
  | 'INSURANCE'
  | 'FITNESS_CERTIFICATE'
  | 'ROUTE_PERMIT'
  | 'TAX_TOKEN'
  | 'LOAN_AGREEMENT'
  | 'OTHER';

export type VehicleCheckType = 'START' | 'END';

export type VehicleServiceType =
  | 'ENGINE_OIL'
  | 'OIL_FILTER'
  | 'AIR_FILTER'
  | 'FUEL_FILTER'
  | 'BRAKE_FLUID'
  | 'BRAKE_PADS'
  | 'COOLANT'
  | 'TRANSMISSION_FLUID'
  | 'TYRE_ROTATION'
  | 'BATTERY'
  | 'SUSPENSION'
  | 'CLUTCH'
  | 'TIMING_BELT'
  | 'SPARK_PLUGS'
  | 'WHEEL_ALIGNMENT'
  | 'AC_SERVICE'
  | 'GENERAL_INSPECTION'
  | 'OTHER';

export interface VehicleChecklistItemDef {
  key: string;
  label: string;
  isCritical: boolean;
}

/**
 * Fixed Phase 1 pre-trip checklist (default-OK grid — driver only taps what's
 * wrong, per plan doc §6/§7.11). isCritical items are the only ones that can
 * ever block trip start, and only when unacknowledged by Staff/Admin
 * (see FleetService.assertVehicleCheckClear + createLoad/loadOut).
 */
export const VEHICLE_CHECKLIST_ITEMS: readonly VehicleChecklistItemDef[] = [
  { key: 'BRAKES', label: 'Brakes working properly', isCritical: true },
  { key: 'TYRES', label: 'Tyres OK (no flat, visible damage)', isCritical: true },
  { key: 'STEERING', label: 'Steering feels normal', isCritical: true },
  { key: 'LIGHTS', label: 'Lights (head/tail/indicators)', isCritical: false },
  { key: 'HORN', label: 'Horn working', isCritical: false },
  { key: 'MIRRORS', label: 'Mirrors intact and adjusted', isCritical: false },
  { key: 'WIPERS', label: 'Wipers working', isCritical: false },
  { key: 'LEAKS_BODY', label: 'No visible leaks or new body damage', isCritical: false },
  { key: 'DOCUMENTS', label: 'Registration & documents on board', isCritical: false },
];

export const VEHICLE_CHECKLIST_ITEM_KEYS: readonly string[] = VEHICLE_CHECKLIST_ITEMS.map((i) => i.key);

export const VEHICLE_CRITICAL_CHECKLIST_KEYS: ReadonlySet<string> = new Set(
  VEHICLE_CHECKLIST_ITEMS.filter((i) => i.isCritical).map((i) => i.key),
);

export interface ChecklistItemResult {
  key: string;
  label: string;
  isCritical: boolean;
  passed: boolean;
  note?: string;
}

export const VEHICLE_SERVICE_TYPE_LABELS: Record<VehicleServiceType, string> = {
  ENGINE_OIL: 'Engine Oil',
  OIL_FILTER: 'Oil Filter',
  AIR_FILTER: 'Air Filter',
  FUEL_FILTER: 'Fuel Filter',
  BRAKE_FLUID: 'Brake Fluid',
  BRAKE_PADS: 'Brake Pads',
  COOLANT: 'Coolant',
  TRANSMISSION_FLUID: 'Transmission Fluid',
  TYRE_ROTATION: 'Tyre Rotation',
  BATTERY: 'Battery',
  SUSPENSION: 'Suspension',
  CLUTCH: 'Clutch',
  TIMING_BELT: 'Timing Belt',
  SPARK_PLUGS: 'Spark Plugs',
  WHEEL_ALIGNMENT: 'Wheel Alignment & Balancing',
  AC_SERVICE: 'AC Service',
  GENERAL_INSPECTION: 'General Safety Inspection',
  OTHER: 'Other',
};

export interface VehicleMaintenanceDefaultInterval {
  intervalKm: number | null;
  intervalDays: number | null;
}

/**
 * Seeded onto every vehicle's VehicleMaintenanceRule rows the first time its
 * maintenance list is opened (lazy upsert, see FleetMaintenanceService). Fully
 * editable afterward per plan doc §7.3 — these are starting defaults, not
 * enforced constants. Sourced from commercial-van PM interval research in the
 * plan doc §1.
 */
export const VEHICLE_MAINTENANCE_DEFAULT_INTERVALS: Record<VehicleServiceType, VehicleMaintenanceDefaultInterval> = {
  ENGINE_OIL: { intervalKm: 5000, intervalDays: 180 },
  OIL_FILTER: { intervalKm: 5000, intervalDays: 180 },
  AIR_FILTER: { intervalKm: 10000, intervalDays: 365 },
  FUEL_FILTER: { intervalKm: 10000, intervalDays: 365 },
  BRAKE_FLUID: { intervalKm: 20000, intervalDays: 365 },
  BRAKE_PADS: { intervalKm: 25000, intervalDays: null },
  COOLANT: { intervalKm: 50000, intervalDays: 365 },
  TRANSMISSION_FLUID: { intervalKm: 50000, intervalDays: 730 },
  TYRE_ROTATION: { intervalKm: 15000, intervalDays: null },
  BATTERY: { intervalKm: null, intervalDays: 730 },
  SUSPENSION: { intervalKm: 50000, intervalDays: 365 },
  CLUTCH: { intervalKm: 60000, intervalDays: null },
  TIMING_BELT: { intervalKm: 100000, intervalDays: 1825 },
  SPARK_PLUGS: { intervalKm: 40000, intervalDays: null },
  WHEEL_ALIGNMENT: { intervalKm: 15000, intervalDays: 365 },
  AC_SERVICE: { intervalKm: null, intervalDays: 365 },
  GENERAL_INSPECTION: { intervalKm: null, intervalDays: 180 },
  OTHER: { intervalKm: null, intervalDays: null },
};

export const VEHICLE_DOCUMENT_TYPE_LABELS: Record<VehicleDocumentType, string> = {
  REGISTRATION: 'Registration Certificate',
  INSURANCE: 'Insurance Policy',
  FITNESS_CERTIFICATE: 'Fitness Certificate',
  ROUTE_PERMIT: 'Route Permit',
  TAX_TOKEN: 'Tax Token',
  LOAN_AGREEMENT: 'Loan / Lease Agreement',
  OTHER: 'Other',
};

/** Odometer delta above this in one day is flagged (not blocked) — plan doc §10 Rule 3. */
export const VEHICLE_DAILY_ODOMETER_DELTA_CAP_KM = 500;

/** Default lead time for a document-expiry reminder when not overridden per-document. */
export const VEHICLE_DOCUMENT_DEFAULT_REMINDER_DAYS = 30;

/** Maintenance status buckets computed at read-time (plan doc §7.4). */
export type VehicleMaintenanceUrgency = 'OK' | 'UPCOMING' | 'DUE' | 'OVERDUE';
