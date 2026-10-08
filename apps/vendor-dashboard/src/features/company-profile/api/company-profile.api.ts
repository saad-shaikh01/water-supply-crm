import { apiClient } from '@water-supply-crm/data-access';

/** Company Profile — contract mirrors apps/api-backend/.../vendor-branding. */

export type PaymentAccountKind = 'BANK' | 'EASYPAISA' | 'JAZZCASH' | 'RAAST';

export interface PaymentAccount {
  kind: PaymentAccountKind;
  accountTitle: string;
  accountNumber: string;
  bankName?: string | null;
  iban?: string | null;
  branch?: string | null;
  note?: string | null;
}

export interface CompanyProfile {
  vendorId: string;
  displayName: string;
  legalName: string | null;
  address: string | null;
  phones: string | null;
  email: string | null;
  website: string | null;
  ntn: string | null;
  strn: string | null;
  logoKey: string | null;
  iconKey: string | null;
  primaryColor: string | null;
  accentColor: string | null;
  paymentAccounts: PaymentAccount[];
  invoiceFooter: string | null;
  updatedAt: string;
}

export interface CompanyProfileView {
  exists: boolean;
  branding: CompanyProfile | null;
  suggested: { displayName: string; address: string | null };
  vendor: { id: string; name: string };
  logoUrl: string | null;
  iconUrl: string | null;
  /** Required-for-go-live fields still empty: displayName | address | phones | paymentAccounts */
  missing: string[];
}

/** What the form submits (every key is whitelisted server-side — send nothing else). */
export interface CompanyProfilePayload {
  displayName: string;
  legalName: string;
  address: string;
  phones: string;
  email: string;
  website: string;
  ntn: string;
  strn: string;
  primaryColor: string;
  accentColor: string;
  invoiceFooter: string;
  paymentAccounts: Array<{
    kind: PaymentAccountKind;
    accountTitle: string;
    accountNumber: string;
    bankName: string;
    iban: string;
    branch: string;
    note: string;
  }>;
}

export type PreviewDoc = 'statement' | 'receipt';
export type ImageKind = 'logo' | 'icon';

/**
 * Vendor admins use `/company-profile`; a SUPER_ADMIN acting for a vendor uses
 * `/vendors/:id/branding` (same payloads).
 */
const base = (vendorId?: string) => (vendorId ? `/vendors/${vendorId}/branding` : '/company-profile');

export const companyProfileApi = {
  get: (vendorId?: string) => apiClient.get<CompanyProfileView>(base(vendorId)),
  save: (payload: CompanyProfilePayload, vendorId?: string) => apiClient.put<CompanyProfileView>(base(vendorId), payload),
  preview: (payload: CompanyProfilePayload, doc: PreviewDoc, vendorId?: string) =>
    apiClient.post<Blob>(`${base(vendorId)}/preview`, payload, { params: { doc }, responseType: 'blob' }),
  uploadImage: (kind: ImageKind, file: File, vendorId?: string) => {
    const form = new FormData();
    form.append('file', file);
    // Content-Type undefined lets the browser set multipart/form-data with the right boundary.
    return apiClient.post<CompanyProfileView>(`${base(vendorId)}/image/${kind}`, form, { headers: { 'Content-Type': undefined } });
  },
  removeImage: (kind: ImageKind, vendorId?: string) => apiClient.delete<CompanyProfileView>(`${base(vendorId)}/image/${kind}`),
};

/** SUPER_ADMIN only: the vendor picker. */
export const vendorsPickerApi = {
  list: () => apiClient.get<{ data?: Array<{ id: string; name: string }> } | Array<{ id: string; name: string }>>('/vendors', { params: { limit: 100 } }),
};
