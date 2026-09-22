import { apiClient } from '@water-supply-crm/data-access';

// Extra Labour Types are a lightweight master list (same pattern as Vehicle
// Maintenance Types): name only, add / rename / delete-if-unused. No
// description and no active/inactive concept — `isSystem` marks the one
// undeletable fallback row ("Other").
export interface ExtraLabourTypeRecord {
  id: string;
  name: string;
  isSystem: boolean;
  inUseCount: number;
}

export interface ExtraLabourOption {
  id: string;
  name: string;
  phone: string | null;
  labourTypeId: string;
  labourTypeName: string;
}

export interface ExtraLabourListItem {
  id: string;
  name: string;
  phone: string | null;
  cnic: string | null;
  labourTypeId: string;
  labourTypeName: string;
  notes: string | null;
  isActive: boolean;
  totalPaid: number;
  lastPaidAt: string | null;
  paymentsCount: number;
}

export interface ExtraLabourProfile {
  id: string;
  name: string;
  phone: string | null;
  cnic: string | null;
  labourTypeId: string;
  labourTypeName: string;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  summary: {
    totalPaid: number;
    paymentsCount: number;
    firstPaidAt: string | null;
    lastPaidAt: string | null;
    largestPayment: number;
    avgPayment: number;
  };
}

export interface ExtraLabourPayment {
  id: string;
  expenseId: string;
  amount: number;
  date: string;
  description: string | null;
  paidFromCash: boolean;
  vanPlateNumber: string | null;
  recordedByName: string | null;
  dailySheetId: string | null;
}

// The 4 KPI cards, exactly as locked: Active Labour / Inactive Labour /
// Paid This Month / Total Paid — nothing more (GET /extra-labour/summary).
export interface ExtraLabourSummary {
  activeCount: number;
  inactiveCount: number;
  paidThisMonth: number;
  totalPaid: number;
}

export interface ExtraLabourQuery {
  page?: number;
  limit?: number;
  search?: string;
  labourTypeId?: string;
  status?: 'ALL' | 'ACTIVE' | 'INACTIVE';
}

export interface ExtraLabourPaymentsQuery {
  page?: number;
  limit?: number;
  from?: string;
  to?: string;
}

export interface CreateExtraLabourDto {
  name: string;
  labourTypeId: string;
  phone?: string | null;
  cnic?: string | null;
  notes?: string | null;
  isActive?: boolean;
}

export interface UpdateExtraLabourDto {
  name?: string;
  labourTypeId?: string;
  phone?: string | null;
  cnic?: string | null;
  notes?: string | null;
  isActive?: boolean;
}

// Types are rename-only — no description, no active/inactive (see
// ExtraLabourTypeRecord's note above).
export interface CreateLabourTypeDto {
  name: string;
}

export interface UpdateLabourTypeDto {
  name: string;
}

export const extraLabourApi = {
  getSummary: () => apiClient.get<ExtraLabourSummary>('/extra-labour/summary'),

  getOptions: (search?: string, labourTypeId?: string, isActive = true, includeId?: string) =>
    apiClient.get<ExtraLabourOption[]>('/extra-labour/options', {
      params: { search, labourTypeId, isActive, includeId },
    }),

  getList: (params: ExtraLabourQuery) =>
    apiClient.get<{ data: ExtraLabourListItem[]; meta: { total: number; page: number; limit: number; totalPages: number } }>(
      '/extra-labour',
      { params },
    ),

  getProfile: (id: string) =>
    apiClient.get<ExtraLabourProfile>(`/extra-labour/${id}`),

  getPayments: (id: string, params: ExtraLabourPaymentsQuery) =>
    apiClient.get<{ data: ExtraLabourPayment[]; meta: { total: number; page: number; limit: number; totalPages: number } }>(
      `/extra-labour/${id}/payments`,
      { params },
    ),

  create: (data: CreateExtraLabourDto) =>
    apiClient.post<{ data: ExtraLabourProfile; warnings?: string[] }>('/extra-labour', data),

  update: (id: string, data: UpdateExtraLabourDto) =>
    apiClient.patch<{ data: ExtraLabourProfile; warnings?: string[] }>(`/extra-labour/${id}`, data),

  getLabourTypes: () => apiClient.get<ExtraLabourTypeRecord[]>('/extra-labour/types'),

  createLabourType: (data: CreateLabourTypeDto) =>
    apiClient.post<ExtraLabourTypeRecord>('/extra-labour/types', data),

  updateLabourType: (id: string, data: UpdateLabourTypeDto) =>
    apiClient.patch<ExtraLabourTypeRecord>(`/extra-labour/types/${id}`, data),

  deleteLabourType: (id: string) => apiClient.delete<{ success: true }>(`/extra-labour/types/${id}`),
};
