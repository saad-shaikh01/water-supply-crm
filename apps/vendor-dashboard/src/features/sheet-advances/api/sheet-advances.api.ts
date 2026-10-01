import { apiClient } from '@water-supply-crm/data-access';

export interface CreateSheetAdvanceData {
  employeeId: string;
  /** Whole positive rupees. */
  amount: number;
  notes?: string;
  /** Required by the server only when the sheet is already closed. */
  reason?: string;
}

export interface UpdateSheetAdvanceData {
  /** Optimistic-concurrency token — the advance's current `version`. */
  version: number;
  employeeId?: string;
  amount?: number;
  notes?: string;
  /** Required by the server only when the sheet is already closed. */
  reason?: string;
}

/**
 * Daily Sheet advances (owner-requested 2026-10-01) — salary advances handed to an
 * employee out of the van's cash. Rows come back inside `GET /daily-sheets/:id`
 * (`sheetAdvances`), so there is no separate list endpoint.
 */
export const sheetAdvancesApi = {
  create: (dailySheetId: string, data: CreateSheetAdvanceData) =>
    apiClient.post(`/daily-sheets/${dailySheetId}/advances`, data),
  update: (id: string, data: UpdateSheetAdvanceData) => apiClient.patch(`/sheet-advances/${id}`, data),
  /** Soft delete. `reason` is mandatory server-side when the sheet is closed. */
  remove: (id: string, reason?: string) =>
    apiClient.delete(`/sheet-advances/${id}`, reason ? { data: { reason } } : undefined),
};
