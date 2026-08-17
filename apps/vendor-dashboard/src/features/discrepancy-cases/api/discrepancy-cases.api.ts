import { apiClient } from '@water-supply-crm/data-access';

export type DiscrepancyType = 'BOTTLE' | 'EMPTY' | 'CASH';
export type DiscrepancyCaseStatus = 'REPORTED' | 'RESOLVED';
export type DiscrepancyResolutionType = 'CHARGED_TO_DRIVER' | 'COMPANY_LOSS' | 'WAIVED';

export interface DiscrepancyCase {
  id: string;
  type: DiscrepancyType;
  status: DiscrepancyCaseStatus;
  reportedQuantity?: number | null;
  reportedAmount?: number | null;
  resolutionType?: DiscrepancyResolutionType | null;
  resolutionAmount?: number | null;
  resolutionNote?: string | null;
  version: number;
  createdAt: string;
  resolvedAt?: string | null;
  driver?: { id: string; name: string } | null;
  resolvedBy?: { id: string; name: string } | null;
  dailySheet?: {
    id: string;
    date: string;
    van?: { id: string; plateNumber: string } | null;
  } | null;
}

export interface DiscrepancyCaseAuditLog {
  id: string;
  action: string;
  actorId: string;
  actorRole: string;
  payload?: Record<string, unknown>;
  createdAt: string;
}

export interface DiscrepancyCaseQuery {
  page?: number;
  limit?: number;
  status?: DiscrepancyCaseStatus;
  type?: DiscrepancyType;
  driverId?: string;
  vanId?: string;
  dailySheetId?: string;
  dateFrom?: string;
  dateTo?: string;
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

export interface ResolveDiscrepancyDto {
  resolutionType: DiscrepancyResolutionType;
  resolutionAmount?: number;
  resolutionNote?: string;
  version: number;
}

export const discrepancyCasesApi = {
  list: (query: DiscrepancyCaseQuery): Promise<{ data: PaginatedResult<DiscrepancyCase> }> =>
    apiClient.get('/sheet-discrepancy-cases', { params: query }),

  getOne: (id: string): Promise<{ data: DiscrepancyCase }> =>
    apiClient.get(`/sheet-discrepancy-cases/${id}`),

  resolve: (id: string, dto: ResolveDiscrepancyDto): Promise<{ data: DiscrepancyCase }> =>
    apiClient.patch(`/sheet-discrepancy-cases/${id}/resolve`, dto),

  getAuditLog: (id: string): Promise<{ data: DiscrepancyCaseAuditLog[] }> =>
    apiClient.get(`/sheet-discrepancy-cases/${id}/audit-log`),
};
