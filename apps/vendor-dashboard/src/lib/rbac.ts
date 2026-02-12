export type Role = 'SUPER_ADMIN' | 'VENDOR_ADMIN' | 'STAFF' | 'DRIVER' | 'CUSTOMER';

const ROLE_HIERARCHY: Record<Role, number> = {
  SUPER_ADMIN: 5,
  VENDOR_ADMIN: 4,
  STAFF: 3,
  DRIVER: 2,
  CUSTOMER: 1,
};

export const hasMinRole = (userRole: Role, minRole: Role): boolean =>
  ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[minRole];

export const isRole = (userRole: Role, role: Role): boolean => userRole === role;
