import { apiClient } from '@water-supply-crm/data-access';

/** Per-vendor WhatsApp sender — contract mirrors apps/api-backend/.../whatsapp (WhatsAppAccountService). */

export type WhatsAppAccountStatus = 'NOT_CONFIGURED' | 'READY' | 'TOKEN_INVALID' | 'SUSPENDED';

export interface WhatsAppAccountSummary {
  id: string;
  label: string;
  wabaId: string | null;
  phoneNumberId: string | null;
  displayNumber: string | null;
  verifiedName: string | null;
  status: WhatsAppAccountStatus;
  qualityRating: string | null;
  lastHealthCheckAt: string | null;
  lastHealthError: string | null;
  hasToken: boolean;
  /** Platform admin only. */
  templateSuffix: string | null;
  templatesSyncedAt: string | null;
  sharedWith: Array<{ id: string; name: string }>;
  sharedCount: number;
}

export interface TemplateItem {
  name: string;
  /** Exactly what must be created on Meta (name + brand suffix when several brands share one WABA). */
  finalName: string;
  title: string;
  usedFor: string;
  required: boolean;
  internal: boolean;
  header: { type: 'NONE' | 'DOCUMENT' | 'IMAGE' | 'TEXT'; text?: string };
  body: string;
  variables: string[];
  sample: string[];
  /** APPROVED | PENDING | REJECTED | PAUSED | … | NOT_FOUND (synced, absent on Meta) | UNKNOWN (never synced) */
  status: string;
  rejectedReason: string | null;
}

export interface TemplatesView {
  brand: string;
  templateSuffix: string | null;
  wabaId: string | null;
  hasAccount: boolean;
  syncedAt: string | null;
  canSync: boolean;
  approvedRequired: number;
  totalRequired: number;
  items: TemplateItem[];
  canEdit: boolean;
}

export interface WhatsAppAccountView {
  masterEnabled: boolean;
  keyConfigured: boolean;
  platformCredentials: boolean;
  account: WhatsAppAccountSummary | null;
  sending: { allowed: boolean; via: 'ACCOUNT' | 'PLATFORM' | 'NONE' };
  canEdit: boolean;
}

export interface ConnectWhatsAppPayload {
  wabaId: string;
  phoneNumberId: string;
  /** Write-only: sent once, never returned. */
  accessToken: string;
  label?: string;
}

export interface PlatformWhatsAppAccount {
  id: string;
  label: string;
  phoneNumberId: string | null;
  displayNumber: string | null;
  status: WhatsAppAccountStatus;
  vendors: Array<{ id: string; name: string }>;
}

/** Vendor admins use `/whatsapp/account`; a SUPER_ADMIN acting for a vendor uses `/vendors/:id/whatsapp-account`. */
const base = (vendorId?: string) => (vendorId ? `/vendors/${vendorId}/whatsapp-account` : '/whatsapp/account');

export const whatsAppAccountApi = {
  get: (vendorId?: string) => apiClient.get<WhatsAppAccountView>(base(vendorId)),
  connect: (payload: ConnectWhatsAppPayload, vendorId?: string) => apiClient.put<WhatsAppAccountView>(base(vendorId), payload),
  verify: (vendorId?: string) => apiClient.post<WhatsAppAccountView>(`${base(vendorId)}/verify`),
  disconnect: (vendorId?: string) => apiClient.delete<WhatsAppAccountView>(base(vendorId)),
  templates: (vendorId?: string) => apiClient.get<TemplatesView>(`${base(vendorId)}/templates`),
  syncTemplates: (vendorId?: string) => apiClient.post<TemplatesView>(`${base(vendorId)}/templates/sync`),
  saveSettings: (templateSuffix: string | null, vendorId?: string) =>
    apiClient.patch<WhatsAppAccountView>(`${base(vendorId)}/settings`, { templateSuffix }),
  // platform admin only
  link: (vendorId: string, accountId: string) => apiClient.post<WhatsAppAccountView>(`${base(vendorId)}/link`, { accountId }),
  importPlatform: (vendorId: string) => apiClient.post<WhatsAppAccountView>(`${base(vendorId)}/import-platform`),
  listAccounts: () => apiClient.get<PlatformWhatsAppAccount[]>('/platform/whatsapp-accounts'),
};
