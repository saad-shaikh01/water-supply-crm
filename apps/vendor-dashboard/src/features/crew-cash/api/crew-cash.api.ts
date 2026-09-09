import { apiClient } from '@water-supply-crm/data-access';
import type { CrewCashCategory, CrewCashEntry } from '@water-supply-crm/types';

export interface CreateCrewCashData {
  employeeId: string;
  category: CrewCashCategory;
  amount: number;
  notes?: string;
}

export interface UpdateCrewCashData {
  /** Optimistic-concurrency token — must match the entry's current `version`. */
  version: number;
  category?: CrewCashCategory;
  amount?: number;
  notes?: string;
}

/**
 * Post-close correction of an already-synced row (`POST /crew-cash/:id/correct`)
 * — reverses the linked Staff Ledger entry, posts a fresh one and rewrites the
 * row. At least one of `newEmployeeId`/`newCategory`/`newAmount` is required;
 * `reason` is mandatory and kept in the audit trail.
 */
export interface CorrectCrewCashData {
  newEmployeeId?: string;
  newCategory?: CrewCashCategory;
  newAmount?: number;
  reason: string;
}

export const crewCashApi = {
  getForSheet: (dailySheetId: string) =>
    apiClient.get<CrewCashEntry[]>(`/daily-sheets/${dailySheetId}/crew-cash`),
  create: (dailySheetId: string, data: CreateCrewCashData) =>
    apiClient.post<CrewCashEntry>(`/daily-sheets/${dailySheetId}/crew-cash`, data),
  update: (id: string, data: UpdateCrewCashData) =>
    apiClient.patch<CrewCashEntry>(`/crew-cash/${id}`, data),
  correct: (id: string, data: CorrectCrewCashData) =>
    apiClient.post<CrewCashEntry>(`/crew-cash/${id}/correct`, data),
  remove: (id: string) => apiClient.delete(`/crew-cash/${id}`),
};
