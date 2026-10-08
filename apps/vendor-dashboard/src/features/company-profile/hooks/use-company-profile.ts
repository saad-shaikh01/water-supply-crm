import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  companyProfileApi,
  vendorsPickerApi,
  type CompanyProfilePayload,
  type ImageKind,
  type PreviewDoc,
} from '../api/company-profile.api';

const KEY = 'company-profile';

/** Pull the server's validation message(s) out of an axios error. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function profileErrorOf(e: any, fallback: string): string {
  const m = e?.response?.data?.message;
  if (Array.isArray(m)) return m.slice(0, 3).join(' · ');
  return typeof m === 'string' && m ? m : fallback;
}

export const useCompanyProfile = (vendorId?: string, enabled = true) =>
  useQuery({
    queryKey: [KEY, vendorId ?? 'self'],
    queryFn: () => companyProfileApi.get(vendorId).then((r) => r.data),
    enabled,
  });

export const useSaveCompanyProfile = (vendorId?: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CompanyProfilePayload) => companyProfileApi.save(payload, vendorId).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, vendorId ?? 'self'] });
      toast.success('Company profile saved — new documents will use it');
    },
    onError: (e) => toast.error(profileErrorOf(e, 'Could not save the company profile')),
  });
};

export const useUploadProfileImage = (vendorId?: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ kind, file }: { kind: ImageKind; file: File }) => companyProfileApi.uploadImage(kind, file, vendorId).then((r) => r.data),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: [KEY, vendorId ?? 'self'] });
      toast.success(v.kind === 'logo' ? 'Logo updated' : 'Icon updated');
    },
    onError: (e) => toast.error(profileErrorOf(e, 'Could not upload the image')),
  });
};

export const useRemoveProfileImage = (vendorId?: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (kind: ImageKind) => companyProfileApi.removeImage(kind, vendorId).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, vendorId ?? 'self'] });
      toast.success('Image removed');
    },
    onError: (e) => toast.error(profileErrorOf(e, 'Could not remove the image')),
  });
};

/** Renders the DRAFT form as a sample PDF and opens it in a new tab. */
export const usePreviewDocument = (vendorId?: string) =>
  useMutation({
    mutationFn: async ({ payload, doc }: { payload: CompanyProfilePayload; doc: PreviewDoc }) => {
      const res = await companyProfileApi.preview(payload, doc, vendorId);
      return new Blob([res.data], { type: 'application/pdf' });
    },
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      // The new tab has loaded the blob by then; free it later.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
    onError: (e) => toast.error(profileErrorOf(e, 'Could not build the preview — check the form for errors')),
  });

export const useVendorPicker = (enabled: boolean) =>
  useQuery({
    queryKey: [KEY, 'vendor-picker'],
    queryFn: async () => {
      const r = await vendorsPickerApi.list();
      const body = r.data;
      return Array.isArray(body) ? body : (body.data ?? []);
    },
    enabled,
    staleTime: 60_000,
  });
