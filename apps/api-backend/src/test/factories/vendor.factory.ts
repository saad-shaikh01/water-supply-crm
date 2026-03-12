import { Vendor } from '@prisma/client';

export const mockVendorId = 'vendor-test-001';
const defaultTimestamp = new Date('2025-01-01T00:00:00.000Z');

export function createMockVendor(overrides: Partial<Vendor> = {}): Vendor {
  return {
    id: mockVendorId,
    name: 'Test Water Co.',
    slug: 'test-water-co',
    address: null,
    logoUrl: null,
    raastId: null,
    isActive: true,
    createdAt: defaultTimestamp,
    updatedAt: defaultTimestamp,
    ...overrides,
  };
}
