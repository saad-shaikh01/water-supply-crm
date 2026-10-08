import { apiClient } from '@water-supply-crm/data-access';

/** Brand identity of the signed-in customer's vendor (GET /portal/branding). Nothing private. */
export interface PortalBranding {
  slug: string;
  name: string;
  /** Short-lived signed URL of the vendor's uploaded logo. */
  logoUrl: string | null;
  /** true => keep the portal's bundled Blue Ice artwork (Dasani only). */
  builtinLogo: boolean;
  primaryColor: string | null;
  accentColor: string | null;
}

export const brandingApi = {
  get: () => apiClient.get<PortalBranding>('/portal/branding'),
};
