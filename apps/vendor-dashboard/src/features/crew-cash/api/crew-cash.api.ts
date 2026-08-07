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

export const crewCashApi = {
  getForSheet: (dailySheetId: string) =>
    apiClient.get<CrewCashEntry[]>(`/daily-sheets/${dailySheetId}/crew-cash`),
  create: (dailySheetId: string, data: CreateCrewCashData) =>
    apiClient.post<CrewCashEntry>(`/daily-sheets/${dailySheetId}/crew-cash`, data),
  update: (id: string, data: UpdateCrewCashData) =>
    apiClient.patch<CrewCashEntry>(`/crew-cash/${id}`, data),
  remove: (id: string) => apiClient.delete(`/crew-cash/${id}`),
};
