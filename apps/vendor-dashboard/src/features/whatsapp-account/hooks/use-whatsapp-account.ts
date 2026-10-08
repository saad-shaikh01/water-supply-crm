import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { whatsAppAccountApi, type ConnectWhatsAppPayload } from '../api/whatsapp-account.api';

const KEY = 'whatsapp-account';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function waErrorOf(e: any, fallback: string): string {
  const m = e?.response?.data?.message;
  if (Array.isArray(m)) return m.slice(0, 3).join(' · ');
  return typeof m === 'string' && m ? m : fallback;
}

export const useWhatsAppAccount = (vendorId?: string, enabled = true) =>
  useQuery({
    queryKey: [KEY, vendorId ?? 'self'],
    queryFn: () => whatsAppAccountApi.get(vendorId).then((r) => r.data),
    enabled,
  });

function useRefreshing(vendorId: string | undefined) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: [KEY, vendorId ?? 'self'] });
    qc.invalidateQueries({ queryKey: ['whatsapp-status'] }); // the status chip on other pages
  };
}

export const useConnectWhatsApp = (vendorId?: string) => {
  const refresh = useRefreshing(vendorId);
  return useMutation({
    mutationFn: (payload: ConnectWhatsAppPayload) => whatsAppAccountApi.connect(payload, vendorId).then((r) => r.data),
    onSuccess: () => {
      refresh();
      toast.success('WhatsApp connected and verified');
    },
    onError: (e) => toast.error(waErrorOf(e, 'Could not connect WhatsApp')),
  });
};

export const useVerifyWhatsApp = (vendorId?: string) => {
  const refresh = useRefreshing(vendorId);
  return useMutation({
    mutationFn: () => whatsAppAccountApi.verify(vendorId).then((r) => r.data),
    onSuccess: (v) => {
      refresh();
      if (v.account?.status === 'READY') toast.success('Connection is healthy');
      else toast.error(v.account?.lastHealthError ?? 'WhatsApp reports a problem with this connection');
    },
    onError: (e) => toast.error(waErrorOf(e, 'Could not verify the connection')),
  });
};

export const useDisconnectWhatsApp = (vendorId?: string) => {
  const refresh = useRefreshing(vendorId);
  return useMutation({
    mutationFn: () => whatsAppAccountApi.disconnect(vendorId).then((r) => r.data),
    onSuccess: () => {
      refresh();
      toast.success('WhatsApp disconnected');
    },
    onError: (e) => toast.error(waErrorOf(e, 'Could not disconnect')),
  });
};

export const useWhatsAppTemplates = (vendorId?: string, enabled = true) =>
  useQuery({
    queryKey: [KEY, 'templates', vendorId ?? 'self'],
    queryFn: () => whatsAppAccountApi.templates(vendorId).then((r) => r.data),
    enabled,
  });

export const useSyncWhatsAppTemplates = (vendorId?: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => whatsAppAccountApi.syncTemplates(vendorId).then((r) => r.data),
    onSuccess: (v) => {
      qc.setQueryData([KEY, 'templates', vendorId ?? 'self'], v);
      toast.success(`Template status refreshed — ${v.approvedRequired} of ${v.totalRequired} required templates approved`);
    },
    onError: (e) => toast.error(waErrorOf(e, 'Could not refresh template status')),
  });
};

export const useSaveWhatsAppSettings = (vendorId?: string) => {
  const refresh = useRefreshing(vendorId);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (templateSuffix: string | null) => whatsAppAccountApi.saveSettings(templateSuffix, vendorId).then((r) => r.data),
    onSuccess: () => {
      refresh();
      qc.invalidateQueries({ queryKey: [KEY, 'templates', vendorId ?? 'self'] });
      toast.success('Template naming saved');
    },
    onError: (e) => toast.error(waErrorOf(e, 'Could not save')),
  });
};

export const usePlatformWhatsAppAccounts = (enabled: boolean) =>
  useQuery({
    queryKey: [KEY, 'platform-accounts'],
    queryFn: () => whatsAppAccountApi.listAccounts().then((r) => r.data),
    enabled,
  });

export const useLinkWhatsApp = (vendorId: string) => {
  const refresh = useRefreshing(vendorId);
  return useMutation({
    mutationFn: (accountId: string) => whatsAppAccountApi.link(vendorId, accountId).then((r) => r.data),
    onSuccess: () => {
      refresh();
      toast.success('Vendor now uses the selected WhatsApp number');
    },
    onError: (e) => toast.error(waErrorOf(e, 'Could not link the account')),
  });
};

export const useImportPlatformWhatsApp = (vendorId: string) => {
  const refresh = useRefreshing(vendorId);
  return useMutation({
    mutationFn: () => whatsAppAccountApi.importPlatform(vendorId).then((r) => r.data),
    onSuccess: () => {
      refresh();
      toast.success('Platform credentials stored for this vendor');
    },
    onError: (e) => toast.error(waErrorOf(e, 'Could not import the platform credentials')),
  });
};
