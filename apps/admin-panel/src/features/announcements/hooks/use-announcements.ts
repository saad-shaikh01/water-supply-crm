'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { announcementsApi, type AnnouncementInput } from '../api/announcements.api';
import { queryKeys } from '../../../lib/query-keys';
import { apiErrorMessage } from '../../../lib/api-error';

export const useAnnouncements = (params: object) =>
  useQuery({
    queryKey: queryKeys.announcements.list(params),
    queryFn: () => announcementsApi.list(params),
    placeholderData: keepPreviousData,
  });

export const useAnnouncement = (id: string) =>
  useQuery({ queryKey: queryKeys.announcements.detail(id), queryFn: () => announcementsApi.get(id) });

export const useAnnouncementStats = (id: string, enabled = true) =>
  useQuery({ queryKey: queryKeys.announcements.stats(id), queryFn: () => announcementsApi.stats(id), enabled, refetchInterval: 15_000 });

export const useActiveVendorCount = (enabled: boolean) =>
  useQuery({ queryKey: ['vendors', 'active-count'], queryFn: announcementsApi.activeVendorCount, enabled, staleTime: 60_000 });

function useAnnouncementMutation<V, R>(fn: (v: V) => Promise<R>, success: string, failure: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.announcements.all });
      toast.success(success);
    },
    onError: (e) => toast.error(apiErrorMessage(e, failure)),
  });
}

export const useCreateAnnouncement = () =>
  useAnnouncementMutation((b: AnnouncementInput) => announcementsApi.create(b), 'Announcement saved', 'Failed to save announcement');

export const useUpdateAnnouncement = () =>
  useAnnouncementMutation(
    (v: { id: string; body: Partial<AnnouncementInput> }) => announcementsApi.update(v.id, v.body),
    'Announcement saved',
    'Failed to save announcement',
  );

export const useSendAnnouncement = () =>
  useAnnouncementMutation((id: string) => announcementsApi.send(id), 'Announcement is being sent', 'Failed to send announcement');

export const useCancelAnnouncement = () =>
  useAnnouncementMutation((id: string) => announcementsApi.cancel(id), 'Announcement cancelled', 'Failed to cancel announcement');

export const useDeleteAnnouncement = () =>
  useAnnouncementMutation((id: string) => announcementsApi.remove(id), 'Draft deleted', 'Failed to delete announcement');
