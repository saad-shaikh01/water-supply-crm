import { apiClient } from '@water-supply-crm/data-access';

export type DamageSeverity = 'MINOR' | 'MODERATE' | 'SEVERE';
export type DamageCaseStatus = 'REPORTED' | 'UNDER_REVIEW' | 'CHARGED' | 'WAIVED' | 'REVERSED';
export type DamageCaseType = 'DAMAGE' | 'LOST';
export type BottleLossReason = 'CUSTOMER_NOT_RETURNED' | 'CUSTOMER_SAID_LOST' | 'WRONG_ADDRESS' | 'OTHER';

export interface DamageCase {
  id: string;
  dailySheetItemId?: string | null;
  driverId: string;
  customerId: string;
  productId: string;
  severity?: DamageSeverity;
  caseType: DamageCaseType;
  lossReason?: BottleLossReason;
  bottleCount: number;
  description?: string | null;
  photoPaths: string[];
  status: DamageCaseStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  customer?: { id: string; name: string; customerCode?: string };
  product?: { id: string; name: string };
  driver?: { id: string; name: string };
}

export interface ReportDamageCaseDto {
  dailySheetItemId?: string;
  customerId: string;
  productId: string;
  severity?: DamageSeverity;
  caseType?: DamageCaseType;
  lossReason?: string;
  bottleCount: number;
  description?: string;
  photoPaths?: string[];
}

export interface PaginatedResult<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export const damageCaseApi = {
  uploadPhoto: (file: File): Promise<{ key: string }> => {
    const formData = new FormData();
    formData.append('file', file);
    return apiClient
      .post<{ key: string }>('/damage-cases/upload-photo', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => r.data);
  },

  reportDamage: (dto: ReportDamageCaseDto): Promise<DamageCase> =>
    apiClient.post<DamageCase>('/damage-cases', dto).then((r) => r.data),

  getMyDamageCases: (params?: {
    page?: number;
    limit?: number;
    status?: DamageCaseStatus;
  }): Promise<PaginatedResult<DamageCase>> =>
    apiClient
      .get<PaginatedResult<DamageCase>>('/damage-cases/my-cases', { params })
      .then((r) => r.data),

  getDamageCase: (id: string): Promise<DamageCase> =>
    apiClient.get<DamageCase>(`/damage-cases/${id}`).then((r) => r.data),

  updateDamageCase: (
    id: string,
    dto: { bottleCount: number; version: number },
  ): Promise<DamageCase> =>
    apiClient.patch<DamageCase>(`/damage-cases/${id}`, dto).then((r) => r.data),
};
