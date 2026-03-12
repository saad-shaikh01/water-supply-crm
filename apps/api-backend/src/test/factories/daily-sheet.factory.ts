import { DailySheet } from '@prisma/client';
import { mockVendorId } from './vendor.factory';

const defaultTimestamp = new Date('2025-01-01T00:00:00.000Z');

export function createMockDailySheet(
  overrides: Partial<DailySheet> = {},
): DailySheet {
  return {
    id: 'sheet-test-001',
    date: new Date('2025-03-10T00:00:00.000Z'),
    vendorId: mockVendorId,
    routeId: null,
    vanId: 'van-test-001',
    driverId: 'user-test-001',
    isClosed: false,
    filledOutCount: 0,
    filledInCount: 0,
    emptyInCount: 0,
    cashExpected: 0,
    cashCollected: 0,
    createdAt: defaultTimestamp,
    updatedAt: defaultTimestamp,
    ...overrides,
  };
}
