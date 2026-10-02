import { apiClient } from '@water-supply-crm/data-access';

export type DamageSeverity = 'MINOR' | 'MODERATE' | 'SEVERE';
export type DamageCaseStatus = 'REPORTED' | 'UNDER_REVIEW' | 'CHARGED' | 'WAIVED' | 'REVERSED';
export type WriteOffCategory = 'CUSTOMER_NEGLIGENCE' | 'NORMAL_WEAR' | 'TRANSIT_ACCIDENT' | 'UNKNOWN';
export type DamageCaseType = 'DAMAGE' | 'LOST';
export type BottleLossReason = 'CUSTOMER_NOT_RETURNED' | 'CUSTOMER_SAID_LOST' | 'WRONG_ADDRESS' | 'OTHER';

export interface DamageCase {
  id: string;
  severity?: DamageSeverity;
  caseType: DamageCaseType;
  lossReason?: BottleLossReason;
  status: DamageCaseStatus;
  bottleCount: number;
  photoKeys: string[];
  photoUrls?: string[];
  reviewNote?: string | null;
  chargeAmount?: number | null;
  writeOffCategory?: WriteOffCategory | null;
  description?: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  reviewedAt?: string | null;
  reviewedBy?: { id: string; name: string } | null;
  /** The field user who REPORTED the case (shown as "Salesman" in the UI). */
  driver?: {
    id: string;
    name: string;
    role?: string;
  } | null;
  customer?: {
    id: string;
    name: string;
    customerCode?: string;
    phoneNumber?: string;
    address?: string;
  } | null;
  /** Detail endpoint only: other cases already on file for the same customer. */
  customerCaseCount?: number;
  customerOpenCount?: number;
  van?: {
    id: string;
    plateNumber: string;
  } | null;
  product?: {
    id: string;
    name: string;
  } | null;
  dailySheet?: {
    id: string;
    date: string;
  } | null;
}

export interface DamageCaseAuditLog {
  id: string;
  action: string;
  actorId: string;
  actorName?: string;
  note?: string | null;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface DamageCaseQuery {
  page?: number;
  limit?: number;
  status?: DamageCaseStatus;
  severity?: DamageSeverity;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  caseType?: DamageCaseType;
  /** Reporter (salesman) id. */
  driverId?: string;
}

export interface DamageCaseSummary {
  total: number;
  totalBottles: number;
  chargedAmount: number;
  byStatus: Partial<Record<DamageCaseStatus, number>>;
}

export interface DamageCaseReporter {
  id: string;
  name: string;
  role: string;
  caseCount: number;
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

export interface ChargeDto {
  chargeAmount: number;
  writeOffCategory: WriteOffCategory;
  reviewNote?: string;
  version: number;
}

export interface WaiveDto {
  writeOffCategory: WriteOffCategory;
  reviewNote?: string;
  version: number;
}

export const damageCasesApi = {
  list: (query: DamageCaseQuery): Promise<{ data: PaginatedResult<DamageCase> }> =>
    apiClient.get('/damage-cases', { params: query }),

  summary: (query: DamageCaseQuery): Promise<{ data: DamageCaseSummary }> =>
    apiClient.get('/damage-cases/summary', { params: query }),

  reporters: (): Promise<{ data: DamageCaseReporter[] }> =>
    apiClient.get('/damage-cases/reporters'),

  getOne: (id: string): Promise<{ data: DamageCase }> =>
    apiClient.get(`/damage-cases/${id}`),

  review: (id: string, version: number): Promise<{ data: DamageCase }> =>
    apiClient.patch(`/damage-cases/${id}/review`, { version }),

  charge: (id: string, dto: ChargeDto): Promise<{ data: DamageCase }> =>
    apiClient.patch(`/damage-cases/${id}/charge`, dto),

  waive: (id: string, dto: WaiveDto): Promise<{ data: DamageCase }> =>
    apiClient.patch(`/damage-cases/${id}/waive`, dto),

  reverse: (id: string, version: number): Promise<{ data: DamageCase }> =>
    apiClient.patch(`/damage-cases/${id}/reverse`, { version }),

  getAuditLog: (id: string): Promise<{ data: DamageCaseAuditLog[] }> =>
    apiClient.get(`/damage-cases/${id}/audit-log`),
};
