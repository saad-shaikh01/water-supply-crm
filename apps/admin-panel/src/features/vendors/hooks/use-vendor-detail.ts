import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { toast } from 'sonner';
import { vendorsApi } from '../api/vendors.api';
import { vendorDetailApi } from '../api/vendor-detail.api';
import { queryKeys } from '../../../lib/query-keys';
import { apiErrorMessage } from '../../../lib/api-error';
import { invalidateVendorData } from './use-vendors';
import type { AuditQuery, BrandingImageKind, BrandingInput, ResetAdminPasswordBody, VendorUsersQuery } from '../types';

export const useVendor = (id: string) =>
  useQuery({
    queryKey: queryKeys.vendors.detail(id),
    queryFn: () => vendorsApi.getOne(id),
    retry: (count, e) => (e as { response?: { status?: number } })?.response?.status !== 404 && count < 2,
  });

export const useVendorStats = (id: string) =>
  useQuery({ queryKey: queryKeys.vendors.stats(id), queryFn: () => vendorDetailApi.getStats(id) });

export const useVendorUsers = (id: string, params: VendorUsersQuery) =>
  useQuery({
    queryKey: queryKeys.vendors.users(id, params),
    queryFn: () => vendorDetailApi.getUsers(id, params),
    placeholderData: keepPreviousData,
  });

export const useVendorReadiness = (id: string) =>
  useQuery({ queryKey: queryKeys.vendors.readiness(id), queryFn: () => vendorDetailApi.getReadiness(id) });

export const useGoLive = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (force: boolean) => vendorDetailApi.goLive(id, force),
    onSuccess: () => {
      invalidateVendorData(qc);
      toast.success('Vendor is now live');
    },
  });
};

export const useGoOffline = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reason?: string) => vendorDetailApi.goOffline(id, reason),
    onSuccess: () => {
      invalidateVendorData(qc);
      toast.success('Vendor taken offline');
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Failed to take the vendor offline')),
  });
};

export const useProvisionVendor = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => vendorDetailApi.provision(id),
    onSuccess: () => invalidateVendorData(qc),
  });
};

export const useResetAdminPassword = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ResetAdminPasswordBody) => vendorDetailApi.resetAdminPassword(id, body),
    // Never toast/log the request body: it carries the new password and the super admin's own password.
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vendors', 'audit', id] }),
  });
};

export const useBranding = (id: string) =>
  useQuery({ queryKey: queryKeys.vendors.branding(id), queryFn: () => vendorDetailApi.getBranding(id) });

const useBrandingInvalidation = (id: string) => {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: queryKeys.vendors.branding(id) });
    qc.invalidateQueries({ queryKey: queryKeys.vendors.readiness(id) });
    qc.invalidateQueries({ queryKey: ['vendors', 'audit', id] });
  };
};

export const useSaveBranding = (id: string) => {
  const done = useBrandingInvalidation(id);
  return useMutation({
    mutationFn: (body: BrandingInput) => vendorDetailApi.saveBranding(id, body),
    onSuccess: () => {
      done();
      toast.success('Branding saved');
    },
  });
};

export const useUploadBrandingImage = (id: string) => {
  const done = useBrandingInvalidation(id);
  return useMutation({
    mutationFn: ({ kind, file }: { kind: BrandingImageKind; file: File }) => vendorDetailApi.uploadBrandingImage(id, kind, file),
    onSuccess: () => {
      done();
      toast.success('Image uploaded');
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Upload failed')),
  });
};

export const useDeleteBrandingImage = (id: string) => {
  const done = useBrandingInvalidation(id);
  return useMutation({
    mutationFn: (kind: BrandingImageKind) => vendorDetailApi.deleteBrandingImage(id, kind),
    onSuccess: () => {
      done();
      toast.success('Image removed');
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not remove the image')),
  });
};

export const useVendorAudit = (id: string, params: Omit<AuditQuery, 'vendorId'>) => {
  const full = { vendorId: id, ...params };
  return useQuery({
    queryKey: queryKeys.vendors.audit(id, full),
    queryFn: () => vendorDetailApi.getAudit(full),
    placeholderData: keepPreviousData,
  });
};
