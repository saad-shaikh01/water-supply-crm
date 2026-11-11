'use client';

import { useRef, useState } from 'react';
import { Button, Skeleton } from '@water-supply-crm/ui';
import { toast } from 'sonner';
import { useBranding, useDeleteBrandingImage, useUploadBrandingImage } from '../../hooks/use-vendor-detail';
import { validateBrandingImage } from '../../schemas/branding';
import { BrandingForm } from './branding-form';
import { ErrorState } from '../../../../components/shared/error-state';
import type { BrandingImageKind, VendorRow } from '../../types';

function ImageSlot({ vendorId, kind, label, url }: { vendorId: string; kind: BrandingImageKind; label: string; url: string | null }) {
  const upload = useUploadBrandingImage(vendorId);
  const remove = useDeleteBrandingImage(vendorId);
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const onPick = (file?: File) => {
    if (!file) return;
    const problem = validateBrandingImage(file);
    if (problem) {
      setError(problem);
      toast.error(problem);
      return;
    }
    setError(null);
    upload.mutate({ kind, file });
  };

  return (
    <div className="flex items-center gap-4 rounded-lg border p-3">
      <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded border bg-muted text-xs text-muted-foreground">
        {url ? <img src={url} alt={`${label} preview`} className="max-h-full max-w-full object-contain" /> : 'None'}
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">PNG, JPG or WebP, up to 1 MB.</p>
        <div className="flex gap-2">
          <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" aria-label={`Upload ${label.toLowerCase()}`} onChange={(e) => { onPick(e.target.files?.[0]); e.target.value = ''; }} />
          <Button size="sm" variant="outline" disabled={upload.isPending} onClick={() => input.current?.click()}>
            {upload.isPending ? 'Uploading…' : url ? 'Replace' : 'Upload'}
          </Button>
          {url && (
            <Button size="sm" variant="ghost" className="text-destructive" disabled={remove.isPending} onClick={() => remove.mutate(kind)}>
              Remove
            </Button>
          )}
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </div>
  );
}

export function BrandingTab({ vendor }: { vendor: VendorRow }) {
  const { data, isLoading, error, refetch } = useBranding(vendor.id);
  if (isLoading) return <Skeleton className="h-96 w-full" aria-busy="true" />;
  if (error || !data) return <ErrorState error={error} onRetry={() => void refetch()} />;

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Branding appears on customer statements and delivery receipts. A display name and at least one payment account are required before go-live.
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        <ImageSlot vendorId={vendor.id} kind="logo" label="Logo" url={data.logoUrl} />
        <ImageSlot vendorId={vendor.id} kind="icon" label="Icon" url={data.iconUrl} />
      </div>
      <BrandingForm vendorId={vendor.id} view={data} />
    </div>
  );
}
