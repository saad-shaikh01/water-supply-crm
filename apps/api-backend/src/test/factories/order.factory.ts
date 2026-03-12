import { CustomerOrder, DispatchStatus, OrderStatus } from '@prisma/client';
import { mockVendorId } from './vendor.factory';

const defaultTimestamp = new Date('2025-01-01T00:00:00.000Z');

export function createMockOrder(
  overrides: Partial<CustomerOrder> = {},
): CustomerOrder {
  return {
    id: 'order-test-001',
    vendorId: mockVendorId,
    customerId: 'customer-test-001',
    productId: 'product-test-001',
    quantity: 2,
    status: OrderStatus.PENDING,
    note: null,
    preferredDate: null,
    reviewedBy: null,
    reviewedAt: null,
    rejectionReason: null,
    dispatchStatus: DispatchStatus.UNPLANNED,
    targetDate: null,
    timeWindow: null,
    dispatchVanId: null,
    dispatchDriverId: null,
    dispatchMode: null,
    dispatchNotes: null,
    plannedAt: null,
    plannedById: null,
    dispatchedAt: null,
    createdAt: defaultTimestamp,
    updatedAt: defaultTimestamp,
    ...overrides,
  };
}
