import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { notificationPreferencesApi } from '../api/notification-preferences.api';

export const PREFERENCE_EVENTS = [
  { key: 'order.approved',   label: 'Order Approved' },
  { key: 'order.rejected',   label: 'Order Rejected' },
  { key: 'order.planned',    label: 'Delivery Scheduled' },
  { key: 'order.dispatched', label: 'Order Out for Delivery' },
  { key: 'delivery.failed',  label: 'Delivery Failed' },
  { key: 'payment.approved', label: 'Payment Approved' },
  { key: 'payment.rejected', label: 'Payment Rejected' },
  { key: 'ticket.replied',   label: 'Support Ticket Reply' },
] as const;

export const PREFERENCE_CHANNELS = [
  { key: 'WHATSAPP', label: 'WhatsApp' },
  { key: 'FCM',      label: 'Push' },
] as const;

type Preference = { eventType: string; channel: string; enabled: boolean };

export function useNotificationPreferences() {
  return useQuery({
    queryKey: ['notification-preferences'],
    queryFn: () => notificationPreferencesApi.getAll().then((r) => r.data as Preference[]),
  });
}

export function useUpsertPreference() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ eventType, channel, enabled }: Preference) =>
      notificationPreferencesApi.upsert(eventType, channel, enabled),
    onMutate: async ({ eventType, channel, enabled }) => {
      await queryClient.cancelQueries({ queryKey: ['notification-preferences'] });
      const previous = queryClient.getQueryData<Preference[]>(['notification-preferences']);
      queryClient.setQueryData<Preference[]>(['notification-preferences'], (old = []) => {
        const idx = old.findIndex((p) => p.eventType === eventType && p.channel === channel);
        if (idx >= 0) {
          const next = [...old];
          next[idx] = { ...next[idx], enabled };
          return next;
        }
        return [...old, { eventType, channel, enabled }];
      });
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(['notification-preferences'], ctx.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['notification-preferences'] });
    },
  });
}
