export interface VendorRow {
  id: string;
  name: string;
  slug: string;
  address?: string | null;
  logoUrl?: string | null;
  raastId?: string | null;
  isActive: boolean;
  goLiveAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  adminEmail?: string | null;
  _counts?: { customers?: number; drivers?: number };
}

export interface PageMeta {
  total: number;
  page: number;
  limit: number;
  totalPages?: number;
}

export interface Paginated<T, M = PageMeta> {
  data: T[];
  meta: M;
}

export type VendorStatusFilter = 'all' | 'active' | 'suspended' | 'live' | 'not_live';
export type VendorSort = 'createdAt' | 'name' | 'customers';
export type SortOrder = 'asc' | 'desc';

export interface VendorListQuery {
  page?: number;
  limit?: number;
  search?: string;
  status?: VendorStatusFilter;
  sort?: VendorSort;
  order?: SortOrder;
}

export interface VendorStats {
  totalCustomers: number;
  totalDrivers: number;
  totalRoutes: number;
  totalVans: number;
  totalUsers: number;
  customerUsers: number;
  activeUsers: number;
  inactiveUsers: number;
  totalRevenue: number | string;
  revenueThisMonth: number | string;
  outstandingBalance: number | string;
  deliveriesThisMonth: number;
  sheetsThisMonth: number;
  lastActiveDate: string | null;
}

export interface VendorStatsResponse {
  vendor: VendorRow;
  stats: VendorStats;
}

export interface VendorUserRow {
  id: string;
  name: string;
  email: string | null;
  role: string;
  roleName: string | null;
  phoneNumber: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface VendorUsersQuery {
  page?: number;
  limit?: number;
  role?: string;
  search?: string;
  isActive?: boolean;
}

export type VendorUsersResponse = Paginated<VendorUserRow, PageMeta & { roleCounts: Record<string, number> }>;

export interface ProvisionResult {
  vendorId: string;
  vendorName: string;
  [key: string]: unknown;
}

export interface CreateVendorInputBody {
  name: string;
  slug: string;
  address?: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
}

export interface CreateVendorResult {
  vendor: VendorRow;
  admin: { id: string; email: string; name: string; role: string };
  provisioning: { summary: Record<string, unknown> };
}

export interface ResetAdminPasswordBody {
  newPassword: string;
  superAdminPassword: string;
  adminUserId?: string;
  reason?: string;
}

export interface ResetAdminPasswordResult {
  message: string;
  userId: string;
  email: string;
  sessionsRevoked: boolean;
}

export interface AdminChoice {
  id: string;
  email: string;
  name: string;
}

export type ReadinessStatus = 'DONE' | 'TODO' | 'WARN';

export interface ReadinessItem {
  key: string;
  label: string;
  required: boolean;
  status: ReadinessStatus;
  detail?: string | null;
  link?: string | null;
}

export interface ReadinessView {
  vendor: { id: string; name: string };
  live: boolean;
  goLiveAt: string | null;
  ready: boolean;
  items: ReadinessItem[];
}

export type PaymentAccountKind = 'BANK' | 'EASYPAISA' | 'JAZZCASH' | 'RAAST';

export interface PaymentAccountInput {
  kind: PaymentAccountKind;
  accountTitle: string;
  accountNumber: string;
  bankName?: string | null;
  iban?: string | null;
  branch?: string | null;
  note?: string | null;
}

export interface BrandingInput {
  displayName: string;
  legalName?: string | null;
  address?: string | null;
  phones?: string | null;
  email?: string | null;
  website?: string | null;
  ntn?: string | null;
  strn?: string | null;
  primaryColor?: string | null;
  accentColor?: string | null;
  invoiceFooter?: string | null;
  paymentAccounts: PaymentAccountInput[];
}

export interface BrandingView {
  exists: boolean;
  branding: (Partial<BrandingInput> & { paymentAccounts: PaymentAccountInput[] }) | null;
  suggested: { displayName: string; address: string | null };
  vendor: { id: string; name: string };
  logoUrl: string | null;
  iconUrl: string | null;
  missing: string[];
}

export type BrandingImageKind = 'logo' | 'icon';
export type BrandingDoc = 'statement' | 'receipt';

export interface AuditLogRow {
  id: string;
  vendorId: string | null;
  userId: string | null;
  userName: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  changes: unknown;
  createdAt: string;
}

export interface AuditQuery {
  vendorId: string;
  page?: number;
  limit?: number;
  action?: string;
  from?: string;
  to?: string;
  entities?: string;
}

export interface BulkResult {
  results: { id: string; ok: boolean; error?: string }[];
  succeeded: number;
  failed: number;
}

export interface DeleteBlocker {
  entity: string;
  count: number | null;
}
