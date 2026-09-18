import { apiClient } from '@water-supply-crm/data-access';
import type { CrewCashCategory, CrewCashEntry, StandaloneCrewCashEntry } from '@water-supply-crm/types';

export interface CreateCrewCashData {
  employeeId: string;
  category: CrewCashCategory;
  amount: number;
  notes?: string;
}

/** No `dailySheetId` — see StandaloneCrewCashExpense in schema.prisma. `date` defaults to now when omitted. */
export interface CreateStandaloneCrewCashData {
  employeeId: string;
  category: CrewCashCategory;
  amount: number;
  date?: string;
  notes?: string;
}

/**
 * Edit a standalone (no-sheet) crew-cash entry in place (P2). Allowed only while
 * its payroll twin is not rolled into a locked payroll period — otherwise the
 * server rejects with an explanation ("void and re-record"). `reason` is
 * mandatory (≥ 5 chars) and kept, with before/after, in the audit trail.
 */
export interface UpdateStandaloneCrewCashData {
  /** Optimistic-concurrency token — the entry's current `version`. */
  version: number;
  employeeId?: string;
  category?: CrewCashCategory;
  amount?: number;
  /** YYYY-MM-DD (or ISO). Future dates are rejected. */
  date?: string;
  notes?: string;
  reason: string;
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
  createStandalone: (data: CreateStandaloneCrewCashData) =>
    apiClient.post<StandaloneCrewCashEntry>('/crew-cash/standalone', data),
  updateStandalone: (id: string, data: UpdateStandaloneCrewCashData) =>
    apiClient.patch<StandaloneCrewCashEntry>(`/crew-cash/standalone/${id}`, data),
  voidStandalone: (id: string, reason: string) =>
    apiClient.patch<StandaloneCrewCashEntry>(`/crew-cash/standalone/${id}/void`, { reason }),
};
