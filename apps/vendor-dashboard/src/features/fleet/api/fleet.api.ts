import { apiClient } from '@water-supply-crm/data-access';
import type {
  VehicleProfileEntry,
  VehicleDocumentEntry,
  VehicleDailyCheckEntry,
  VehicleCheckHistoryEntry,
  FuelLogEntry,
  VehicleMaintenanceRuleEntry,
  VehicleServiceRecordEntry,
  VehicleServiceTypeEntry,
  VehicleMaintenanceStatusEntry,
  VehicleFuelType,
  VehicleOwnershipType,
  VehicleOperationalStatus,
  VehicleDocumentType,
  VehicleCheckType,
  VehicleServiceType,
  ChecklistItemResult,
  FleetAlertRecipientEntry,
} from '@water-supply-crm/types';

// The shared `PaginatedResponse<T>` type in @water-supply-crm/types is flat
// and does not match what the backend's `paginate()` helper actually returns
// (data + nested meta) — same known mismatch damage-case.api.ts works around
// with its own local `PaginatedResult<T>`. Mirrored here as `FleetPaginatedResult`
// rather than relying on the stale shared type.
export interface FleetPaginatedResult<T> {
  data: T[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

// §17 Amendment (2026-08-21) — Fleet's list/detail pages are keyed by
// `vehicleId` (the physical vehicle) now, not `vanId` (the route/slot) — see
// docs/features/fleet-operations-vehicle-intelligence.md §17. `usualVanId`
// is shown for route context only (a default, not a constraint).
/** Cost/km/efficiency for one vehicle over a period (a month on the list, any range on the detail page). */
export interface VehiclePeriodStats {
  fuelCost: number;
  fuelLiters: number;
  fuelFills: number;
  maintenanceCost: number;
  serviceCount: number;
  otherCost: number;
  totalCost: number;
  kmDriven: number;
  daysUsed: number;
  costPerKm: number | null;
  avgKmPerLiter: number | null;
  avgPricePerLiter: number | null;
  lastFuelAt: string | null;
}

export interface VehicleMonthlyRow extends VehiclePeriodStats {
  month: string; // YYYY-MM
}

export interface VehicleListTotals {
  fuelCost: number;
  fuelLiters: number;
  maintenanceCost: number;
  otherCost: number;
  totalCost: number;
  kmDriven: number;
  costPerKm: number | null;
}

export type VehicleSortField = 'plateNumber' | 'totalCost' | 'fuelCost' | 'kmDriven' | 'costPerKm';

export interface FuelLogSummary {
  fills: number;
  totalCost: number;
  totalLiters: number;
  avgPricePerLiter: number | null;
  avgKmPerLiter: number | null;
}

export interface FuelLogFilters {
  page?: number;
  limit?: number;
  vehicleId?: string;
  dateFrom?: string;
  dateTo?: string;
  recordedById?: string;
  fuelCardId?: string;
  payment?: 'cash' | 'other';
  tank?: 'full' | 'partial';
  station?: string;
}

export interface VehicleOtherExpenseEntry {
  id: string;
  category: string;
  amount: number;
  description: string;
  date: string;
  paidFromCash: boolean;
  createdBy: { id: string; name: string };
  dailySheet: { id: string; date: string; van: { id: string; plateNumber: string } } | null;
}

export interface VehicleListEntry {
  id: string;
  plateNumber: string;
  isActive: boolean;
  usualVanId: string | null;
  usualVanDefaultDriver: { id: string; name: string } | null;
  profile: VehicleProfileEntry | null;
  expiringDocumentCount: number;
  costThisMonth: number;
  /** Present only when the list was requested with `month`. */
  period?: VehiclePeriodStats;
}

export interface VehicleDetail {
  id: string;
  plateNumber: string;
  isActive: boolean;
  usualVanId: string | null;
  usualVanDefaultDriver: { id: string; name: string } | null;
  vehicleProfile: VehicleProfileEntry | null;
  vehicleDocuments: VehicleDocumentEntry[];
}

export interface FleetOverview {
  vehicleCount: number;
  totalOverdueMaintenance: number;
  totalDueMaintenance: number;
  vehiclesWithOverdue: { vehicleId: string; plateNumber: string; overdueCount: number; dueCount: number }[];
  expiringDocuments: (VehicleDocumentEntry & { vehicle: { id: string; plateNumber: string } })[];
  costThisMonth: number;
  fuelCostThisMonth: number;
  fuelLitersThisMonth: number;
}

export interface VehicleCostSummary {
  vehicleId: string;
  totalCost: number;
  fuelCostTotal: number;
  fuelLitersTotal: number;
  fuelFillCount: number;
  maintenanceCostTotal: number;
  maintenanceServiceCount: number;
  currentOdometer: number;
  costPerKm: number | null;
  /** Real-world fuel efficiency (km per litre), full-to-full method. Null if too few fills. */
  fuelAvgKmPerLiter: number | null;
}

export interface UpdateVehicleProfileData {
  version?: number;
  make?: string;
  model?: string;
  year?: number | null;
  color?: string;
  chassisNumber?: string;
  engineNumber?: string;
  fuelType?: VehicleFuelType | null;
  transmissionType?: string;
  loadCapacityKg?: number | null;
  seatingCapacity?: number | null;
  ownershipType?: VehicleOwnershipType | null;
  purchaseDate?: string;
  purchaseCost?: number | null;
  supplierName?: string;
  operationalStatus?: VehicleOperationalStatus;
}

export interface CreateVehicleDocumentData {
  type: VehicleDocumentType;
  documentNumber?: string;
  issuingAuthority?: string;
  issueDate?: string;
  expiryDate?: string;
  fileKey?: string;
  reminderDaysBefore?: number;
  notes?: string;
}

export interface CreateVehicleDailyCheckData {
  dailySheetId: string;
  checkType: VehicleCheckType;
  // Required on START (picker), omitted on END (inherited server-side from
  // the sheet's own START check) — §17 Amendment (2026-08-21).
  vehicleId?: string;
  odometerReading: number;
  odometerPhotoKey?: string;
  fuelGaugeLevel?: number;
  checklistResults: { key: string; passed: boolean; note?: string }[];
  damageNoted?: boolean;
  damageNote?: string;
  damagePhotoKeys?: string[];
  note?: string;
}

export interface CreateFuelLogData {
  vehicleId: string;
  dailySheetId?: string;
  date: string;
  odometerAtFill: number;
  litersFilled: number;
  amountPaid: number;
  isFullTank?: boolean;
  paidFromCash?: boolean;
  // Fuel Card Wallet (owner-requested 2026-09-15) — see fuelLogSchema.
  fuelCardId?: string;
  fuelStation?: string;
  receiptPhotoKey?: string;
  notes?: string;
}

export interface CreateServiceRecordData {
  vehicleId: string;
  serviceType: VehicleServiceType;
  performedAtOdometer: number;
  performedAtDate: string;
  cost: number;
  workshopName?: string;
  invoicePhotoKey?: string;
  partsReplaced?: string;
  notes?: string;
}

export interface CreateServiceTypeData {
  label: string;
  defaultIntervalKm?: number;
  defaultIntervalDays?: number;
}

export interface CreateFleetAlertRecipientData {
  name: string;
  phone: string;
}

export interface UpdateFleetAlertRecipientData {
  name?: string;
  phone?: string;
  isActive?: boolean;
}

export interface CreateVehicleData {
  plateNumber: string;
  usualVanId?: string;
}

export interface UpdateVehicleData {
  plateNumber?: string;
  usualVanId?: string | null;
}

export const fleetApi = {
  uploadPhoto: (file: File): Promise<{ key: string }> => {
    const formData = new FormData();
    formData.append('file', file);
    return apiClient
      .post<{ key: string }>('/fleet/upload-photo', formData, { headers: { 'Content-Type': 'multipart/form-data' } })
      .then((r) => r.data);
  },

  // Vehicles (base CRUD) & documents
  getVehicles: (params?: {
    page?: number;
    limit?: number;
    search?: string;
    operationalStatus?: VehicleOperationalStatus;
    active?: boolean;
    month?: string;
    sortBy?: VehicleSortField;
    sortDir?: 'asc' | 'desc';
  }) =>
    apiClient
      .get<FleetPaginatedResult<VehicleListEntry> & { meta: { month?: string; totals?: VehicleListTotals } }>('/fleet/vehicles', { params })
      .then((r) => r.data),
  getVehicle: (vehicleId: string) => apiClient.get<VehicleDetail>(`/fleet/vehicles/${vehicleId}`).then((r) => r.data),
  createVehicle: (data: CreateVehicleData) => apiClient.post<VehicleDetail>('/fleet/vehicles', data).then((r) => r.data),
  updateVehicleBasic: (vehicleId: string, data: UpdateVehicleData) =>
    apiClient.patch<VehicleDetail>(`/fleet/vehicles/${vehicleId}/basic`, data).then((r) => r.data),
  deactivateVehicle: (vehicleId: string) =>
    apiClient.patch<VehicleDetail>(`/fleet/vehicles/${vehicleId}/deactivate`).then((r) => r.data),
  reactivateVehicle: (vehicleId: string) =>
    apiClient.patch<VehicleDetail>(`/fleet/vehicles/${vehicleId}/reactivate`).then((r) => r.data),
  updateVehicleProfile: (vehicleId: string, data: UpdateVehicleProfileData) =>
    apiClient.patch<VehicleProfileEntry>(`/fleet/vehicles/${vehicleId}`, data).then((r) => r.data),
  addDocument: (vehicleId: string, data: CreateVehicleDocumentData) =>
    apiClient.post<VehicleDocumentEntry>(`/fleet/vehicles/${vehicleId}/documents`, data).then((r) => r.data),
  updateDocument: (id: string, data: Partial<CreateVehicleDocumentData>) =>
    apiClient.patch<VehicleDocumentEntry>(`/fleet/vehicles/documents/${id}`, data).then((r) => r.data),
  deactivateDocument: (id: string) =>
    apiClient.patch<VehicleDocumentEntry>(`/fleet/vehicles/documents/${id}/deactivate`).then((r) => r.data),

  // Dashboard
  getOverview: () => apiClient.get<FleetOverview>('/fleet/overview').then((r) => r.data),
  getCostSummary: (vehicleId: string) =>
    apiClient.get<VehicleCostSummary>(`/fleet/vehicles/${vehicleId}/cost-summary`).then((r) => r.data),

  getPeriodSummary: (vehicleId: string, params?: { dateFrom?: string; dateTo?: string }) =>
    apiClient.get<VehiclePeriodStats>(`/fleet/vehicles/${vehicleId}/period-summary`, { params }).then((r) => r.data),
  getMonthlyReport: (vehicleId: string, params?: { months?: number; endMonth?: string }) =>
    apiClient.get<VehicleMonthlyRow[]>(`/fleet/vehicles/${vehicleId}/monthly-report`, { params }).then((r) => r.data),
  getOtherExpenses: (vehicleId: string, params?: { dateFrom?: string; dateTo?: string; page?: number; limit?: number }) =>
    apiClient
      .get<FleetPaginatedResult<VehicleOtherExpenseEntry> & { summary: { totalAmount: number } }>(
        `/fleet/vehicles/${vehicleId}/other-expenses`,
        { params },
      )
      .then((r) => r.data),

  // Daily checks
  createDailyCheck: (data: CreateVehicleDailyCheckData) =>
    apiClient.post<VehicleDailyCheckEntry>('/fleet/daily-checks', data).then((r) => r.data),
  getChecksForSheet: (dailySheetId: string) =>
    apiClient.get<VehicleDailyCheckEntry[]>(`/fleet/daily-checks/sheet/${dailySheetId}`).then((r) => r.data),
  // Per-vehicle daily meter-reading history — Fleet detail page "Meter Readings" tab.
  getVehicleCheckHistory: (vehicleId: string, params?: { page?: number; limit?: number; dateFrom?: string; dateTo?: string }) =>
    apiClient
      .get<FleetPaginatedResult<VehicleCheckHistoryEntry>>(`/fleet/daily-checks/vehicle/${vehicleId}/history`, { params })
      .then((r) => r.data),
  // Odometer Correction (2026-08-23) — Staff/Admin fixing a mis-entered
  // reading on an already-submitted check. `reason` is mandatory server-side.
  updateDailyCheck: (id: string, data: { odometerReading: number; reason: string }) =>
    apiClient.patch<VehicleDailyCheckEntry>(`/fleet/daily-checks/${id}`, data).then((r) => r.data),
  overrideCriticalCheck: (id: string, note: string) =>
    apiClient.patch<VehicleDailyCheckEntry>(`/fleet/daily-checks/${id}/override-critical`, { note }).then((r) => r.data),

  // Fuel logs
  createFuelLog: (data: CreateFuelLogData) => apiClient.post<FuelLogEntry>('/fleet/fuel-logs', data).then((r) => r.data),
  getFuelLogs: (params?: FuelLogFilters) =>
    apiClient
      .get<FleetPaginatedResult<FuelLogEntry> & { summary: FuelLogSummary }>('/fleet/fuel-logs', { params })
      .then((r) => r.data),
  // Single-record fetch — used by the Expense Center detail drawer (Phase
  // 2b) to pre-fill FuelLogFormDialog's edit mode by `sourceRecordId`.
  getFuelLog: (id: string) => apiClient.get<FuelLogEntry>(`/fleet/fuel-logs/${id}`).then((r) => r.data),
  updateFuelLog: (id: string, data: Partial<CreateFuelLogData>) =>
    apiClient.patch<FuelLogEntry>(`/fleet/fuel-logs/${id}`, data).then((r) => r.data),
  removeFuelLog: (id: string) => apiClient.delete(`/fleet/fuel-logs/${id}`),

  // Maintenance
  getMaintenanceStatusForVehicle: (vehicleId: string) =>
    apiClient.get<VehicleMaintenanceStatusEntry[]>(`/fleet/maintenance/vehicles/${vehicleId}/status`).then((r) => r.data),
  getFleetMaintenanceStatus: () =>
    apiClient
      .get<{ vehicles: { vehicleId: string; plateNumber: string; overdueCount: number; dueCount: number }[]; totalOverdue: number; totalDue: number }>(
        '/fleet/maintenance/status',
      )
      .then((r) => r.data),
  updateMaintenanceRule: (id: string, data: { intervalKm?: number | null; intervalDays?: number | null; isActive?: boolean }) =>
    apiClient.patch<VehicleMaintenanceRuleEntry>(`/fleet/maintenance/rules/${id}`, data).then((r) => r.data),
  createServiceRecord: (data: CreateServiceRecordData) =>
    apiClient.post<VehicleServiceRecordEntry>('/fleet/maintenance/service-records', data).then((r) => r.data),
  getServiceRecords: (params?: { page?: number; limit?: number; vehicleId?: string; serviceType?: VehicleServiceType; dateFrom?: string; dateTo?: string }) =>
    apiClient
      .get<FleetPaginatedResult<VehicleServiceRecordEntry> & { summary: { count: number; totalCost: number } }>('/fleet/maintenance/service-records', { params })
      .then((r) => r.data),
  // Single-record fetch — used by the Expense Center detail drawer (Phase
  // 2b) to pre-fill ServiceRecordFormDialog's edit mode by `sourceRecordId`.
  getServiceRecord: (id: string) =>
    apiClient.get<VehicleServiceRecordEntry>(`/fleet/maintenance/service-records/${id}`).then((r) => r.data),
  // PATCH/DELETE below call endpoints added alongside this phase's backend
  // half (permission `fleet:manage_maintenance`, same DTO shape as create
  // minus required-ness) — see docs/features/expense-center §08.
  updateServiceRecord: (id: string, data: Partial<CreateServiceRecordData>) =>
    apiClient.patch<VehicleServiceRecordEntry>(`/fleet/maintenance/service-records/${id}`, data).then((r) => r.data),
  removeServiceRecord: (id: string) => apiClient.delete(`/fleet/maintenance/service-records/${id}`),

  // Per-vendor service-type catalogue (Record Service dropdown). Delete is
  // rejected (409) while any service record still uses the type.
  getServiceTypes: () =>
    apiClient.get<VehicleServiceTypeEntry[]>('/fleet/maintenance/service-types').then((r) => r.data),
  createServiceType: (data: CreateServiceTypeData) =>
    apiClient.post<VehicleServiceTypeEntry>('/fleet/maintenance/service-types', data).then((r) => r.data),
  renameServiceType: (
    id: string,
    data: { label: string; defaultIntervalKm?: number | null; defaultIntervalDays?: number | null },
  ) => apiClient.patch<VehicleServiceTypeEntry>(`/fleet/maintenance/service-types/${id}`, data).then((r) => r.data),
  removeServiceType: (id: string) => apiClient.delete(`/fleet/maintenance/service-types/${id}`),

  // Fleet Alert Recipients (owner-requested 2026-09-29) — the WhatsApp numbers
  // (e.g. owner/manager) the nightly document-expiry / maintenance-due sweep
  // also notifies, vendor-wide (not per-vehicle).
  getAlertRecipients: () =>
    apiClient.get<FleetAlertRecipientEntry[]>('/fleet/alert-recipients').then((r) => r.data),
  createAlertRecipient: (data: CreateFleetAlertRecipientData) =>
    apiClient.post<FleetAlertRecipientEntry>('/fleet/alert-recipients', data).then((r) => r.data),
  updateAlertRecipient: (id: string, data: UpdateFleetAlertRecipientData) =>
    apiClient.patch<FleetAlertRecipientEntry>(`/fleet/alert-recipients/${id}`, data).then((r) => r.data),
  removeAlertRecipient: (id: string) => apiClient.delete(`/fleet/alert-recipients/${id}`),
};

export type { ChecklistItemResult };
