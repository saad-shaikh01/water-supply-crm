import { apiClient } from '@water-supply-crm/data-access';

/**
 * Fuel Card Wallet (owner-requested 2026-09-15). A fuel card top-up (office
 * cash -> a specific card) is a transfer between two custodial cash pools, not
 * an Expense — it draws down the Office Cash Ledger's available balance (see
 * `van-cash-ledger.api.ts` — `CashLedgerStats.totalFuelCardTopUps` / the
 * `FUEL_CARD_TOPUP_OUT` timeline row) but is never itself a company cost. The
 * real cost is still, and only, recognized when fuel is actually filled into
 * a vehicle (FuelLog -> FUEL_EXPENSE), unchanged.
 */

export interface FuelCard {
  id: string;
  name: string;
  cardNumber: string | null;
  issuer: string | null;
  isActive: boolean;
  /** One-time carry-forward baseline, e.g. a card that already had cash loaded before being registered here. */
  openingBalance: number;
  /** Server-computed, not cached: openingBalance + ACTIVE top-ups minus fuel-card-paid FuelLog fills. */
  balance: number;
  createdAt: string;
}

export interface CreateFuelCardPayload {
  name: string;
  cardNumber?: string;
  issuer?: string;
  openingBalance?: number;
}

export interface UpdateFuelCardPayload {
  name?: string;
  cardNumber?: string;
  issuer?: string;
  isActive?: boolean;
  openingBalance?: number;
}

export type FuelCardTopUpStatus = 'ACTIVE' | 'VOIDED';

export interface FuelCardTopUp {
  id: string;
  fuelCardId: string;
  fuelCard: { id: string; name: string } | null;
  amount: number;
  date: string;
  reference: string | null;
  attachmentKey: string | null;
  note: string | null;
  status: FuelCardTopUpStatus;
  createdBy: { id: string; name: string } | null;
  voidedBy: { id: string; name: string } | null;
  voidedAt: string | null;
  voidReason: string | null;
  createdAt: string;
}

export interface CreateFuelCardTopUpPayload {
  amount: number;
  date: string;
  reference?: string;
  note?: string;
  attachmentKey?: string;
}

export interface VoidFuelCardTopUpPayload {
  voidReason: string;
}

export interface FuelCardTopUpQuery {
  fuelCardId?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
}

export interface FuelCardTopUpListResponse {
  data: FuelCardTopUp[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

export const fuelCardApi = {
  listCards: () => apiClient.get<FuelCard[]>('/fuel-cards'),
  createCard: (data: CreateFuelCardPayload) => apiClient.post<FuelCard>('/fuel-cards', data),
  updateCard: (id: string, data: UpdateFuelCardPayload) =>
    apiClient.patch<FuelCard>(`/fuel-cards/${id}`, data),

  listTopUps: (params?: FuelCardTopUpQuery) =>
    apiClient.get<FuelCardTopUpListResponse>('/fuel-cards/top-ups', { params }),
  createTopUp: (fuelCardId: string, data: CreateFuelCardTopUpPayload) =>
    apiClient.post<FuelCardTopUp & { cardBalance: number }>(`/fuel-cards/${fuelCardId}/top-ups`, data),
  voidTopUp: (id: string, data: VoidFuelCardTopUpPayload) =>
    apiClient.patch<FuelCardTopUp & { cardBalance: number }>(`/fuel-cards/top-ups/${id}/void`, data),
  uploadTopUpAttachment: (file: File): Promise<{ key: string }> => {
    const formData = new FormData();
    formData.append('file', file);
    return apiClient
      .post<{ key: string }>('/fuel-cards/top-ups/attachment', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => r.data);
  },
  getTopUpAttachment: (id: string) =>
    apiClient.get<{ signedUrl: string }>(`/fuel-cards/top-ups/${id}/attachment`),
};
