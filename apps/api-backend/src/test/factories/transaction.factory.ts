import { Transaction, TransactionType } from '@prisma/client';
import { mockVendorId } from './vendor.factory';

const defaultTimestamp = new Date('2025-01-01T00:00:00.000Z');

export function createMockTransaction(
  overrides: Partial<Transaction> = {},
): Transaction {
  return {
    id: 'txn-test-001',
    type: TransactionType.PAYMENT,
    vendorId: mockVendorId,
    customerId: 'customer-test-001',
    productId: null,
    dailySheetId: null,
    dailySheetItemId: null,
    bottleCount: null,
    filledDropped: null,
    emptyReceived: null,
    amount: 300,
    description: null,
    createdAt: defaultTimestamp,
    ...overrides,
  };
}
