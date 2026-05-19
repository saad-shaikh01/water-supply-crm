export type UserRoleType =
  | 'VENDOR_ADMIN'
  | 'STAFF'
  | 'DRIVER'
  | 'SUPER_ADMIN'
  | 'CUSTOMER';

export interface AuthUser {
  userId: string;
  email: string;
  name: string;
  role: UserRoleType;
  vendorId: string;
  customerId: string | null;
}
