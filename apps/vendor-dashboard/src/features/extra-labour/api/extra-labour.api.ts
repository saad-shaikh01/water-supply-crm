import { apiClient } from '@water-supply-crm/data-access';

export interface ExtraLabourTypeRecord {
  id: string;
  name: string;
  description?: string | null;
  isActive: boolean;
  labourCount?: number;
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
    lastPaidAt: string | null;
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

export interface ExtraLabourSummary {
  activeLabourersCount: number;
  totalPaidRange: number;
  paymentsCountRange: number;
  byType: Array<{
    labourTypeId: string;
    labourTypeName: string;
    count: number;
    totalPaid: number;
  }>;
}

export interface ExtraLabourQuery {
  page?: number;
  limit?: number;
  search?: string;
  labourTypeId?: string;
  isActive?: boolean;
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

export interface CreateLabourTypeDto {
  name: string;
  description?: string | null;
}

export interface UpdateLabourTypeDto {
  name?: string;
  description?: string | null;
  isActive?: boolean;
}

export const extraLabourApi = {
  getSummary: (from?: string, to?: string) =>
    apiClient.get<ExtraLabourSummary>('/extra-labour/summary', { params: { from, to } }),

  getOptions: (search?: string, labourTypeId?: string, isActive?: boolean) =>
    apiClient.get<ExtraLabourOption[]>('/extra-labour/options', {
      params: { search, labourTypeId, isActive: isActive ?? true },
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

  getLabourTypes: (includeInactive = false) =>
    apiClient.get<ExtraLabourTypeRecord[]>('/extra-labour/types', {
      params: { includeInactive },
    }),

  createLabourType: (data: CreateLabourTypeDto) =>
    apiClient.post<ExtraLabourTypeRecord>('/extra-labour/types', data),

  updateLabourType: (id: string, data: UpdateLabourTypeDto) =>
    apiClient.patch<ExtraLabourTypeRecord>(`/extra-labour/types/${id}`, data),
};
