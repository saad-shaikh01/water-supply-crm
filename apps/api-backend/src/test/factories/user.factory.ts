import { User, UserRole } from '@prisma/client';
import { mockVendorId } from './vendor.factory';

const defaultTimestamp = new Date('2025-01-01T00:00:00.000Z');

export function createMockUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-test-001',
    email: 'driver@test.com',
    password: '$2b$10$hashedpassword',
    name: 'Test Driver',
    phoneNumber: null,
    role: UserRole.DRIVER,
    isActive: true,
    vendorId: mockVendorId,
    createdAt: defaultTimestamp,
    updatedAt: defaultTimestamp,
    ...overrides,
  };
}

export function createMockVendorAdmin(overrides: Partial<User> = {}): User {
  return createMockUser({
    id: 'user-admin-001',
    email: 'admin@test.com',
    role: UserRole.VENDOR_ADMIN,
    ...overrides,
  });
}
