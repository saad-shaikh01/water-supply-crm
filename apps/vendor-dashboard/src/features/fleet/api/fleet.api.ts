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

export interface VehicleListEntry {
  id: string;
  plateNumber: string;
  isActive: boolean;
  defaultDriver: { id: string; name: string } | null;
  profile: VehicleProfileEntry | null;
  expiringDocumentCount: number;
  costThisMonth: number;
}

export interface VehicleDetail {
  id: string;
  plateNumber: string;
  isActive: boolean;
  defaultDriver: { id: string; name: string } | null;
  vehicleProfile: VehicleProfileEntry | null;
  vehicleDocuments: VehicleDocumentEntry[];
}

export interface FleetOverview {
  vehicleCount: number;
  totalOverdueMaintenance: number;
  totalDueMaintenance: number;
  vehiclesWithOverdue: { vanId: string; plateNumber: string; overdueCount: number; dueCount: number }[];
  expiringDocuments: (VehicleDocumentEntry & { van: { id: string; plateNumber: string } })[];
  costThisMonth: number;
  fuelCostThisMonth: number;
  fuelLitersThisMonth: number;
}

export interface VehicleCostSummary {
  vanId: string;
  totalCost: number;
  costByCategory: { category: string; totalAmount: number; count: number }[];
  fuelCostTotal: number;
  fuelLitersTotal: number;
  fuelFillCount: number;
  maintenanceCostTotal: number;
  maintenanceServiceCount: number;
  currentOdometer: number;
  costPerKm: number | null;
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
  vanId: string;
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
  vanId: string;
  serviceType: VehicleServiceType;
  performedAtOdometer: number;
  performedAtDate: string;
  cost: number;
  workshopName?: string;
  invoicePhotoKey?: string;
  partsReplaced?: string;
  notes?: string;
}

export const fleetApi = {
  uploadPhoto: (file: File): Promise<{ key: string }> => {
    const formData = new FormData();
    formData.append('file', file);
    return apiClient
      .post<{ key: string }>('/fleet/upload-photo', formData, { headers: { 'Content-Type': 'multipart/form-data' } })
      .then((r) => r.data);
  },

  // Vehicles & documents
  getVehicles: (params?: { page?: number; limit?: number; search?: string; operationalStatus?: VehicleOperationalStatus }) =>
    apiClient.get<FleetPaginatedResult<VehicleListEntry>>('/fleet/vehicles', { params }).then((r) => r.data),
  getVehicle: (vanId: string) => apiClient.get<VehicleDetail>(`/fleet/vehicles/${vanId}`).then((r) => r.data),
  updateVehicleProfile: (vanId: string, data: UpdateVehicleProfileData) =>
    apiClient.patch<VehicleProfileEntry>(`/fleet/vehicles/${vanId}`, data).then((r) => r.data),
  addDocument: (vanId: string, data: CreateVehicleDocumentData) =>
    apiClient.post<VehicleDocumentEntry>(`/fleet/vehicles/${vanId}/documents`, data).then((r) => r.data),
  updateDocument: (id: string, data: Partial<CreateVehicleDocumentData>) =>
    apiClient.patch<VehicleDocumentEntry>(`/fleet/vehicles/documents/${id}`, data).then((r) => r.data),
  deactivateDocument: (id: string) =>
    apiClient.patch<VehicleDocumentEntry>(`/fleet/vehicles/documents/${id}/deactivate`).then((r) => r.data),

  // Dashboard
  getOverview: () => apiClient.get<FleetOverview>('/fleet/overview').then((r) => r.data),
  getCostSummary: (vanId: string) =>
    apiClient.get<VehicleCostSummary>(`/fleet/vehicles/${vanId}/cost-summary`).then((r) => r.data),

  // Daily checks
  createDailyCheck: (data: CreateVehicleDailyCheckData) =>
    apiClient.post<VehicleDailyCheckEntry>('/fleet/daily-checks', data).then((r) => r.data),
  getChecksForSheet: (dailySheetId: string) =>
    apiClient.get<VehicleDailyCheckEntry[]>(`/fleet/daily-checks/sheet/${dailySheetId}`).then((r) => r.data),
  overrideCriticalCheck: (id: string, note: string) =>
    apiClient.patch<VehicleDailyCheckEntry>(`/fleet/daily-checks/${id}/override-critical`, { note }).then((r) => r.data),

  // Fuel logs
  createFuelLog: (data: CreateFuelLogData) => apiClient.post<FuelLogEntry>('/fleet/fuel-logs', data).then((r) => r.data),
  getFuelLogs: (params?: { page?: number; limit?: number; vanId?: string; dateFrom?: string; dateTo?: string }) =>
    apiClient.get<FleetPaginatedResult<FuelLogEntry>>('/fleet/fuel-logs', { params }).then((r) => r.data),
  updateFuelLog: (id: string, data: Partial<CreateFuelLogData>) =>
    apiClient.patch<FuelLogEntry>(`/fleet/fuel-logs/${id}`, data).then((r) => r.data),
  removeFuelLog: (id: string) => apiClient.delete(`/fleet/fuel-logs/${id}`),

  // Maintenance
  getMaintenanceStatusForVan: (vanId: string) =>
    apiClient.get<VehicleMaintenanceStatusEntry[]>(`/fleet/maintenance/vehicles/${vanId}/status`).then((r) => r.data),
  getFleetMaintenanceStatus: () =>
    apiClient
      .get<{ vehicles: { vanId: string; plateNumber: string; overdueCount: number; dueCount: number }[]; totalOverdue: number; totalDue: number }>(
        '/fleet/maintenance/status',
      )
      .then((r) => r.data),
  updateMaintenanceRule: (id: string, data: { intervalKm?: number | null; intervalDays?: number | null; isActive?: boolean }) =>
    apiClient.patch<VehicleMaintenanceRuleEntry>(`/fleet/maintenance/rules/${id}`, data).then((r) => r.data),
  createServiceRecord: (data: CreateServiceRecordData) =>
    apiClient.post<VehicleServiceRecordEntry>('/fleet/maintenance/service-records', data).then((r) => r.data),
  getServiceRecords: (params?: { page?: number; limit?: number; vanId?: string; serviceType?: VehicleServiceType }) =>
    apiClient
      .get<FleetPaginatedResult<VehicleServiceRecordEntry>>('/fleet/maintenance/service-records', { params })
      .then((r) => r.data),
};

export type { ChecklistItemResult };
