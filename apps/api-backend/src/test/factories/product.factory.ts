import { Product } from '@prisma/client';
import { mockVendorId } from './vendor.factory';

const defaultTimestamp = new Date('2025-01-01T00:00:00.000Z');

export function createMockProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'product-test-001',
    name: '19L Water Bottle',
    description: null,
    basePrice: 150,
    vendorId: mockVendorId,
    isActive: true,
    createdAt: defaultTimestamp,
    updatedAt: defaultTimestamp,
    ...overrides,
  };
}
