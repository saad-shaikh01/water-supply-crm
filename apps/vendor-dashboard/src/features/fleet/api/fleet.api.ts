import { apiClient } from '@water-supply-crm/data-access';
import type {
  VehicleProfileEntry,
  VehicleDocumentEntry,
  VehicleDailyCheckEntry,
  FuelLogEntry,
  VehicleMaintenanceRuleEntry,
  VehicleServiceRecordEntry,
  VehicleMaintenanceStatusEntry,
  VehicleFuelType,
  VehicleOwnershipType,
  VehicleOperationalStatus,
  VehicleDocumentType,
  VehicleCheckType,
  VehicleServiceType,
  ChecklistItemResult,
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
export interface VehicleListEntry {
  id: string;
  plateNumber: string;
  isActive: boolean;
  usualVanId: string | null;
  usualVanDefaultDriver: { id: string; name: string } | null;
  profile: VehicleProfileEntry | null;
  expiringDocumentCount: number;
  costThisMonth: number;
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
  getVehicles: (params?: { page?: number; limit?: number; search?: string; operationalStatus?: VehicleOperationalStatus; active?: boolean }) =>
    apiClient.get<FleetPaginatedResult<VehicleListEntry>>('/fleet/vehicles', { params }).then((r) => r.data),
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

  // Daily checks
  createDailyCheck: (data: CreateVehicleDailyCheckData) =>
    apiClient.post<VehicleDailyCheckEntry>('/fleet/daily-checks', data).then((r) => r.data),
  getChecksForSheet: (dailySheetId: string) =>
    apiClient.get<VehicleDailyCheckEntry[]>(`/fleet/daily-checks/sheet/${dailySheetId}`).then((r) => r.data),
  // Odometer Correction (2026-08-23) — Staff/Admin fixing a mis-entered
  // reading on an already-submitted check. `reason` is mandatory server-side.
  updateDailyCheck: (id: string, data: { odometerReading: number; reason: string }) =>
    apiClient.patch<VehicleDailyCheckEntry>(`/fleet/daily-checks/${id}`, data).then((r) => r.data),
  overrideCriticalCheck: (id: string, note: string) =>
    apiClient.patch<VehicleDailyCheckEntry>(`/fleet/daily-checks/${id}/override-critical`, { note }).then((r) => r.data),

  // Fuel logs
  createFuelLog: (data: CreateFuelLogData) => apiClient.post<FuelLogEntry>('/fleet/fuel-logs', data).then((r) => r.data),
  getFuelLogs: (params?: { page?: number; limit?: number; vehicleId?: string; dateFrom?: string; dateTo?: string }) =>
    apiClient.get<FleetPaginatedResult<FuelLogEntry>>('/fleet/fuel-logs', { params }).then((r) => r.data),
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
  getServiceRecords: (params?: { page?: number; limit?: number; vehicleId?: string; serviceType?: VehicleServiceType }) =>
    apiClient
      .get<FleetPaginatedResult<VehicleServiceRecordEntry>>('/fleet/maintenance/service-records', { params })
      .then((r) => r.data),
};

export type { ChecklistItemResult };
