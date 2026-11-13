import { apiClient, unwrap } from '../../../lib/api';

export type BillingInterval = 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
export type SubscriptionStatus = 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED';
export type InvoiceStatus = 'DRAFT' | 'OPEN' | 'PAID' | 'VOID';
/** Mirrors the backend enum InvoicePaymentMethod. */
export type InvoicePaymentMethod = 'CASH' | 'BANK_TRANSFER' | 'RAAST' | 'CHEQUE' | 'OTHER';

export const PAYMENT_METHODS: { value: InvoicePaymentMethod; label: string }[] = [
  { value: 'CASH', label: 'Cash' },
  { value: 'BANK_TRANSFER', label: 'Bank transfer' },
  { value: 'RAAST', label: 'Raast' },
  { value: 'CHEQUE', label: 'Cheque' },
  { value: 'OTHER', label: 'Other' },
];

export interface Paginated<T> {
  data: T[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

/** null = unlimited */
export interface Limits {
  maxCustomers: number | null;
  maxDrivers: number | null;
  maxVans: number | null;
}
export interface Usage {
  customers: number;
  drivers: number;
  vans: number;
}

export interface Plan extends Limits {
  id: string;
  name: string;
  description: string | null;
  price: string | number;
  currency: string;
  interval: BillingInterval;
  trialDays: number;
  isActive: boolean;
  sortOrder: number;
  _count?: { subscriptions: number };
  affectedVendors?: number;
}

export interface PlanInput {
  name: string;
  description?: string;
  price: number;
  interval: BillingInterval;
  trialDays?: number;
  maxCustomers: number | null;
  maxDrivers: number | null;
  maxVans: number | null;
  isActive?: boolean;
}

export interface SubscriptionRow {
  vendor: { id: string; name: string };
  plan: Plan;
  status: SubscriptionStatus;
  trialEndsAt: string | null;
  currentPeriodEnd: string;
  usage: Usage;
  limits: Limits;
}

export interface InvoicePayment {
  id: string;
  amount: string | number;
  method: InvoicePaymentMethod;
  reference: string | null;
  paidOn: string;
  notes: string | null;
}

export interface Invoice {
  id: string;
  number: string;
  vendorId: string;
  vendor?: { id: string; name: string };
  status: InvoiceStatus;
  description: string | null;
  amount: string | number;
  currency: string;
  issuedAt: string;
  dueAt: string;
  paidAt: string | null;
  voidReason: string | null;
  payments?: InvoicePayment[];
}

export interface VendorSubscriptionView {
  subscription:
    | (Omit<SubscriptionRow, 'vendor' | 'usage' | 'limits'> & {
        id: string;
        cancelReason: string | null;
        currentPeriodStart: string;
        notes: string | null;
      })
    | null;
  limits: Limits | null;
  usage: Usage;
  recentInvoices: Invoice[];
}

export interface AssignSubscriptionInput {
  planId: string;
  startTrial?: boolean;
  trialDays?: number;
  overrides?: Partial<Limits>;
  notes?: string;
}
export interface AssignSubscriptionResult {
  warnings: string[];
}

export interface CreateInvoiceInput {
  vendorId: string;
  amount: number;
  description?: string;
  dueAt: string;
  status?: 'DRAFT' | 'OPEN';
}
export interface RecordPaymentInput {
  amount: number;
  method: InvoicePaymentMethod;
  paidOn: string;
  reference?: string;
  notes?: string;
}

export const billingApi = {
  plans: (includeInactive = true) => unwrap(apiClient.get<Plan[]>('/platform/plans', { params: { includeInactive } })),
  createPlan: (b: PlanInput) => unwrap(apiClient.post<Plan>('/platform/plans', b)),
  updatePlan: (id: string, b: Partial<PlanInput>) => unwrap(apiClient.patch<Plan>(`/platform/plans/${id}`, b)),
  deletePlan: (id: string) => unwrap(apiClient.delete(`/platform/plans/${id}`)),

  subscriptions: (params: object) => unwrap(apiClient.get<Paginated<SubscriptionRow>>('/platform/subscriptions', { params })),
  vendorSubscription: (vendorId: string) =>
    unwrap(apiClient.get<VendorSubscriptionView>(`/platform/vendors/${vendorId}/subscription`)),
  assign: (vendorId: string, b: AssignSubscriptionInput) =>
    unwrap(apiClient.put<AssignSubscriptionResult>(`/platform/vendors/${vendorId}/subscription`, b)),
  cancel: (vendorId: string, reason: string) =>
    unwrap(apiClient.post(`/platform/vendors/${vendorId}/subscription/cancel`, { reason })),
  reactivate: (vendorId: string) => unwrap(apiClient.post(`/platform/vendors/${vendorId}/subscription/reactivate`)),

  invoices: (params: object) => unwrap(apiClient.get<Paginated<Invoice>>('/platform/invoices', { params })),
  invoice: (id: string) => unwrap(apiClient.get<Invoice>(`/platform/invoices/${id}`)),
  createInvoice: (b: CreateInvoiceInput) => unwrap(apiClient.post<Invoice>('/platform/invoices', b)),
  issueInvoice: (id: string) => unwrap(apiClient.post<Invoice>(`/platform/invoices/${id}/issue`)),
  recordPayment: (id: string, b: RecordPaymentInput) =>
    unwrap(apiClient.post<{ invoice: Invoice; payment: InvoicePayment }>(`/platform/invoices/${id}/payments`, b)),
  voidInvoice: (id: string, reason: string) => unwrap(apiClient.post<Invoice>(`/platform/invoices/${id}/void`, { reason })),
};
