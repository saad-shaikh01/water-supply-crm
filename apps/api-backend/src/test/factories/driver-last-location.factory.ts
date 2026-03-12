import { DriverLastLocation } from '@prisma/client';
import { mockVendorId } from './vendor.factory';

const defaultTimestamp = new Date('2025-01-01T00:00:00.000Z');

export function createMockDriverLastLocation(
  overrides: Partial<DriverLastLocation> = {},
): DriverLastLocation {
  return {
    id: 'driver-location-test-001',
    driverId: 'user-test-001',
    vendorId: mockVendorId,
    latitude: 24.8607,
    longitude: 67.0011,
    speed: null,
    bearing: null,
    status: 'ONLINE',
    vanId: null,
    dailySheetId: null,
    lastSeenAt: defaultTimestamp,
    createdAt: defaultTimestamp,
    updatedAt: defaultTimestamp,
    ...overrides,
  };
}
