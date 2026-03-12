import { Customer, PaymentType } from '@prisma/client';
import { mockVendorId } from './vendor.factory';

const defaultTimestamp = new Date('2025-01-01T00:00:00.000Z');

export function createMockCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: 'customer-test-001',
    customerCode: 'CUST-001',
    name: 'Test Customer',
    phoneNumber: '03009876543',
    address: '123 Test Street, Karachi',
    floor: null,
    nearbyLandmark: null,
    deliveryInstructions: null,
    googleMapsUrl: null,
    latitude: null,
    longitude: null,
    vendorId: mockVendorId,
    routeId: null,
    userId: null,
    paymentType: PaymentType.CASH,
    isActive: true,
    financialBalance: 0,
    createdAt: defaultTimestamp,
    updatedAt: defaultTimestamp,
    ...overrides,
  };
}
