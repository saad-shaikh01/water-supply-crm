export type UserRoleType =
  | 'VENDOR_ADMIN'
  | 'STAFF'
  | 'DRIVER'
  | 'SALESMAN'
  | 'LOADER'
  | 'SUPER_ADMIN'
  | 'CUSTOMER';

export interface AuthUser {
  userId: string;
  email: string;
  name: string;
  role: UserRoleType;
  vendorId: string;
  customerId: string | null;
  /** Present only for SUPER_ADMIN impersonation sessions (Phase 4 / track B). */
  impersonation?: {
    sessionId: string;
    actorId: string;
    actorName: string;
    mode: 'READ_ONLY' | 'SUPPORT';
    /** ISO expiry of the impersonation token (drives the banner countdown). */
    expiresAt?: string;
  };
}
