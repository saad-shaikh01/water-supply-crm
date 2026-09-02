import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { balanceRemindersApi, PreviewPayload, SendTargetedPayload, UpdateWarningConfigPayload } from '../api/balance-reminders.api';

export const useSendRemindersNow = () => {
  return useMutation({
    mutationFn: (data?: Record<string, unknown>) => balanceRemindersApi.sendNow(data),
    onSuccess: (res) => {
      const data = (res as any).data;
      const count = data?.sent ?? data?.count ?? '?';
      toast.success(`Reminders sent to ${count} customers`);
    },
    onError: () => toast.error('Failed to send reminders'),
  });
};

export const useSendTargeted = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: SendTargetedPayload) => balanceRemindersApi.sendTargeted(payload),
    onSuccess: (res) => {
      const data = (res as any).data;
      const count = data?.sent ?? 0;
      const month = data?.month ?? '';
      const withStatement = data?.includeStatement ? ' with statement' : '';
      toast.success(`Sent ${count} reminder${count !== 1 ? 's' : ''}${withStatement} for ${month}`);
      // a non-dry-run send writes a new ReminderSendLog row
      if (!data?.dryRun) qc.invalidateQueries({ queryKey: ['reminder-history'] });
    },
    onError: () => toast.error('Failed to send reminders'),
  });
};

export const usePreviewReminders = () => {
  return useMutation({
    mutationFn: (payload: PreviewPayload) => balanceRemindersApi.preview(payload),
    onError: () => toast.error('Failed to load preview'),
  });
};

export const useWhatsAppStatus = () =>
  useQuery({
    queryKey: ['whatsapp-status'],
    queryFn: () => balanceRemindersApi.getWhatsAppStatus().then((r) => r.data),
    refetchInterval: 10_000,
  });

export const useReminderHistory = (
  page = 1,
  limit = 10,
  filters?: { dateFrom?: string; dateTo?: string; result?: string; kind?: string },
) =>
  useQuery({
    queryKey: ['reminder-history', page, limit, filters?.dateFrom ?? '', filters?.dateTo ?? '', filters?.result ?? '', filters?.kind ?? ''],
    queryFn: () => balanceRemindersApi.getHistory(page, limit, filters).then((r) => r.data),
    placeholderData: (prev) => prev,
  });

export const useReminderHistoryDetail = (id: string | null) =>
  useQuery({
    queryKey: ['reminder-history-detail', id],
    queryFn: () => balanceRemindersApi.getHistoryDetail(id as string).then((r) => r.data),
    enabled: !!id,
  });

export const useReminderConfig = () =>
  useQuery({
    queryKey: ['balance-reminder-config'],
    queryFn: () => balanceRemindersApi.getConfig().then((r) => r.data),
  });

export const useUpdateReminderConfig = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: UpdateWarningConfigPayload) => balanceRemindersApi.updateConfig(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['balance-reminder-config'] });
      toast.success('Warning settings saved');
    },
    onError: () => toast.error('Failed to save warning settings'),
  });
};
