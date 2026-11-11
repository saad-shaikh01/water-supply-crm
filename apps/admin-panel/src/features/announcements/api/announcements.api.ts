import { apiClient, unwrap } from '../../../lib/api';
import type { Paginated } from '../../billing/api/billing.api';

export type AnnouncementStatus = 'DRAFT' | 'SCHEDULED' | 'SENDING' | 'SENT' | 'CANCELLED' | 'FAILED';
export type AnnouncementSeverity = 'INFO' | 'IMPORTANT' | 'CRITICAL';
export type AnnouncementAudience = 'ALL_VENDORS' | 'SELECTED_VENDORS';

export interface Announcement {
  id: string;
  title: string;
  body: string;
  severity: AnnouncementSeverity;
  audience: AnnouncementAudience;
  status: AnnouncementStatus;
  scheduledFor: string | null;
  sentAt: string | null;
  cancelledAt: string | null;
  recipientCount: number;
  lastError: string | null;
  createdByName: string;
  createdAt: string;
  _count?: { vendors: number };
  vendors?: { vendorId: string; vendor: { id: string; name: string } }[];
}

export interface AnnouncementStats {
  status: AnnouncementStatus;
  recipientCount: number;
  delivered: number;
  read: number;
  /** 0..1 */
  readRate: number;
  byVendor: { vendorId: string; name: string; delivered: number; read: number }[];
}

export interface AnnouncementInput {
  title: string;
  body: string;
  severity: AnnouncementSeverity;
  audience: AnnouncementAudience;
  vendorIds?: string[];
  scheduledFor?: string | null;
}

export const announcementsApi = {
  list: (params: object) => unwrap(apiClient.get<Paginated<Announcement>>('/platform/announcements', { params })),
  get: (id: string) => unwrap(apiClient.get<Announcement>(`/platform/announcements/${id}`)),
  stats: (id: string) => unwrap(apiClient.get<AnnouncementStats>(`/platform/announcements/${id}/stats`)),
  create: (b: AnnouncementInput) => unwrap(apiClient.post<Announcement>('/platform/announcements', b)),
  update: (id: string, b: Partial<AnnouncementInput>) => unwrap(apiClient.patch<Announcement>(`/platform/announcements/${id}`, b)),
  send: (id: string) => unwrap(apiClient.post<Announcement>(`/platform/announcements/${id}/send`)),
  cancel: (id: string) => unwrap(apiClient.post<Announcement>(`/platform/announcements/${id}/cancel`)),
  remove: (id: string) => unwrap(apiClient.delete(`/platform/announcements/${id}`)),
  activeVendorCount: async (): Promise<number> => {
    const res = await apiClient.get<{ meta?: { total?: number } }>('/vendors', { params: { limit: 1, status: 'active' } });
    return res.data.meta?.total ?? 0;
  },
};
