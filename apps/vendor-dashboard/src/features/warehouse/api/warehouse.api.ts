import { apiClient } from '@water-supply-crm/data-access';

export interface WarehouseStock {
  id: string;
  vendorId: string;
  productId: string;
  filledCount: number;
  emptyCount: number;
  damagedCount: number;
  leakedCount: number;
  inRepairCount: number;
  updatedAt: string;
  product: { id: string; name: string; basePrice: number; isActive: boolean };
}

export interface WarehouseTransaction {
  id: string;
  vendorId: string;
  productId: string;
  type: string;
  filledDelta: number;
  emptyDelta: number;
  damagedDelta: number;
  leakedDelta: number;
  repairDelta: number;
  notes: string | null;
  dailySheetId: string | null;
  repairBatchId: string | null;
  createdAt: string;
  product: { id: string; name: string };
  createdBy: { id: string; name: string; role: string } | null;
  repairBatch: { id: string; shopName: string } | null;
}

export interface RepairBatch {
  id: string;
  vendorId: string;
  productId: string;
  shopName: string;
  bottlesSent: number;
  bottlesReturned: number;
  bottlesWrittenOff: number;
  status: 'SENT' | 'PARTIALLY_RETURNED' | 'COMPLETED';
  sentAt: string;
  returnedAt: string | null;
  notes: string | null;
  product: { id: string; name: string };
  createdBy: { id: string; name: string } | null;
}

export interface WarehouseUniverse {
  warehouseFilled: number;
  warehouseEmpty: number;
  warehouseDamaged: number;
  warehouseLeaked: number;
  warehouseInRepair: number;
  repairBatchesInTransit: number;
  vansInTransit: number;
  customersWalletTotal: number;
  grandTotal: number;
  byProduct: WarehouseStock[];
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export const warehouseApi = {
  getStock: () =>
    apiClient.get<WarehouseStock[]>('/warehouse/stock'),
  getUniverse: () =>
    apiClient.get<WarehouseUniverse>('/warehouse/universe'),
  getTransactions: (params: {
    page?: number;
    limit?: number;
    productId?: string;
    type?: string;
    dateFrom?: string;
    dateTo?: string;
  }) =>
    apiClient.get<PaginatedResponse<WarehouseTransaction>>('/warehouse/transactions', { params }),
  getRepairBatches: (params: {
    page?: number;
    limit?: number;
    productId?: string;
    status?: string;
  }) =>
    apiClient.get<PaginatedResponse<RepairBatch>>('/warehouse/repairs', { params }),
  openingBalance: (data: {
    productId: string;
    filledCount: number;
    emptyCount: number;
    damagedCount: number;
    leakedCount: number;
    notes?: string;
  }) => apiClient.post('/warehouse/opening-balance', data),
  fillIn: (data: { productId: string; quantity: number; notes?: string }) =>
    apiClient.post('/warehouse/fill-in', data),
  refill: (data: { productId: string; quantity: number; notes?: string }) =>
    apiClient.post('/warehouse/refill', data),
  markDamaged: (data: { productId: string; quantity: number; fromStock: 'empty' | 'filled'; notes?: string }) =>
    apiClient.post('/warehouse/mark-damaged', data),
  markLeaked: (data: { productId: string; quantity: number; fromStock: 'empty' | 'filled'; notes?: string }) =>
    apiClient.post('/warehouse/mark-leaked', data),
  sendRepair: (data: { productId: string; quantity: number; shopName: string; fromStock: 'damaged' | 'empty'; notes?: string }) =>
    apiClient.post('/warehouse/send-repair', data),
  returnRepair: (batchId: string, data: { bottlesReturned: number; bottlesWrittenOff: number; notes?: string }) =>
    apiClient.patch(`/warehouse/repairs/${batchId}/return`, data),
  writeOff: (data: { productId: string; quantity: number; fromStock: 'damaged' | 'leaked'; notes?: string }) =>
    apiClient.post('/warehouse/write-off', data),
  adjustment: (data: { productId: string; filledAdjust: number; emptyAdjust: number; damagedAdjust: number; leakedAdjust: number; notes: string }) =>
    apiClient.post('/warehouse/adjustment', data),
};
