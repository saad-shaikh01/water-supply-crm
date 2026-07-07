import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  notificationSettingsApi,
  NotificationSettingRow,
  UpdateNotificationSettingPayload,
} from '../api/notification-settings.api';

const QUERY_KEY = ['notification-settings'];

export const useNotificationSettings = () =>
  useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => notificationSettingsApi.getMatrix().then((r) => r.data),
  });

export const useUpdateNotificationSetting = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: UpdateNotificationSettingPayload) =>
      notificationSettingsApi.update(payload),

    // Optimistic toggle — flip immediately, roll back on error
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey: QUERY_KEY });
      const previous = queryClient.getQueryData<NotificationSettingRow[]>(QUERY_KEY);

      queryClient.setQueryData<NotificationSettingRow[]>(QUERY_KEY, (rows) =>
        rows?.map((row) =>
          row.type === payload.type
            ? { ...row, channels: { ...row.channels, [payload.channel]: payload.enabled } }
            : row,
        ),
      );

      return { previous };
    },

    onError: (_err, _payload, context) => {
      if (context?.previous) queryClient.setQueryData(QUERY_KEY, context.previous);
      toast.error('Failed to update notification setting');
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
};
