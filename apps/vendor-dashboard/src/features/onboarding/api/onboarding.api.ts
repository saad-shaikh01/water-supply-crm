import { apiClient } from '@water-supply-crm/data-access';

/** Go-live checklist — contract mirrors apps/api-backend/.../vendor-readiness. */
export type ReadinessStatus = 'DONE' | 'TODO' | 'WARN';

export interface ReadinessItem {
  key: string;
  label: string;
  required: boolean;
  status: ReadinessStatus;
  detail: string;
  link: string;
}

export interface ReadinessView {
  vendor: { id: string; name: string };
  live: boolean;
  goLiveAt: string | null;
  ready: boolean;
  items: ReadinessItem[];
}

export const onboardingApi = {
  readiness: () => apiClient.get<ReadinessView>('/onboarding/readiness'),
  goLive: () => apiClient.post<ReadinessView>('/onboarding/go-live'),
};
