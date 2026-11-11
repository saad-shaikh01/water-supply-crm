'use client';

import { useState } from 'react';
import { Badge, Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input, Label, Skeleton } from '@water-supply-crm/ui';
import { AlertTriangle, CheckCircle2, Circle } from 'lucide-react';
import { apiErrorMessage } from '../../hooks/use-vendors';
import { useGoLive, useGoOffline, useVendorReadiness } from '../../hooks/use-vendor-detail';
import { TypedConfirmDialog } from '../../../../components/shared/typed-confirm-dialog';
import { ErrorState } from '../../../../components/shared/error-state';
import type { ReadinessItem, VendorRow } from '../../types';
import type { VendorTab } from './vendor-detail-client';

const BRANDING_KEYS = ['company_profile', 'payment_accounts'];

function StatusIcon({ status }: { status: ReadinessItem['status'] }) {
  if (status === 'DONE') return <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-label="Done" />;
  if (status === 'WARN') return <AlertTriangle className="h-5 w-5 text-amber-500" aria-label="Warning" />;
  return <Circle className="h-5 w-5 text-muted-foreground" aria-label="To do" />;
}

export function ReadinessTab({ vendor, onOpenTab }: { vendor: VendorRow; onOpenTab: (t: VendorTab) => void }) {
  const { data, isLoading, error, refetch } = useVendorReadiness(vendor.id);
  const goLive = useGoLive(vendor.id);
  const goOffline = useGoOffline(vendor.id);
  const [force, setForce] = useState(false);
  const [offline, setOffline] = useState(false);
  const [reason, setReason] = useState('');

  if (isLoading) return <Skeleton className="h-64 w-full" aria-busy="true" />;
  if (error || !data) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const required = data.items.filter((i) => i.required);
  const done = required.filter((i) => i.status === 'DONE').length;
  const labelOf = (key: string) => data.items.find((i) => i.key === key)?.label ?? key;
  const openItems = required.filter((i) => i.status !== 'DONE');

  // 409 body: { message, open: string[] } (item keys) -> labels
  const err409 = (goLive.error as { response?: { status?: number; data?: { open?: string[] } } } | null)?.response;
  const openFromApi = err409?.status === 409 && Array.isArray(err409.data?.open) ? err409.data.open.map(labelOf) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold">
            {done} of {required.length} required items done
          </p>
          <div className="mt-2 h-2 w-64 max-w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={required.length}>
            <div className="h-full bg-emerald-500" style={{ width: `${required.length ? (done / required.length) * 100 : 0}%` }} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={data.live ? 'info' : 'warning'}>{data.live ? 'Live' : 'Setup'}</Badge>
          {data.live ? (
            <Button variant="outline" onClick={() => setOffline(true)}>
              Take offline
            </Button>
          ) : (
            <>
              <Button disabled={!data.ready || goLive.isPending} onClick={() => goLive.mutate(false)}>
                {goLive.isPending && !force ? 'Going live…' : 'Go live'}
              </Button>
              {!data.ready && (
                <Button variant="outline" onClick={() => setForce(true)}>
                  Force go-live
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {goLive.error && !force && (
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <p>{apiErrorMessage(goLive.error, 'Could not go live.')}</p>
          {openFromApi && (
            <ul className="mt-1 list-disc pl-5">
              {openFromApi.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <ul className="divide-y rounded-lg border bg-card" aria-label="Readiness checklist">
        {data.items.map((item) => (
          <li key={item.key} className="flex items-start gap-3 px-4 py-3" data-item={item.key} data-status={item.status}>
            <StatusIcon status={item.status} />
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {item.label}
                {item.required && <span className="ml-1 text-xs font-normal text-muted-foreground">(required)</span>}
              </p>
              {item.detail && <p className="text-sm text-muted-foreground">{item.detail}</p>}
            </div>
            {item.status !== 'DONE' &&
              (BRANDING_KEYS.includes(item.key) ? (
                <Button size="sm" variant="outline" onClick={() => onOpenTab('branding')}>
                  Open Branding
                </Button>
              ) : (
                <span className="max-w-[14rem] text-right text-xs text-muted-foreground">Vendor completes this in their dashboard</span>
              ))}
          </li>
        ))}
      </ul>

      <TypedConfirmDialog
        open={force}
        onOpenChange={(o) => {
          setForce(o);
          if (!o) goLive.reset();
        }}
        title="Force go-live"
        description={
          <>
            <strong>{vendor.name}</strong> will be marked live although required items are still open. This is recorded in the audit log.
          </>
        }
        phrase={vendor.slug}
        confirmLabel="Force go-live"
        isPending={goLive.isPending}
        onConfirm={() => goLive.mutate(true, { onSuccess: () => setForce(false) })}
      >
        <div className="text-sm">
          <p className="mb-1 font-medium">Still open:</p>
          <ul className="list-disc pl-5" aria-label="Open items">
            {(openFromApi ?? openItems.map((i) => i.label)).map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
        {goLive.error && (
          <p role="alert" className="text-sm text-destructive">
            {apiErrorMessage(goLive.error, 'Could not go live.')}
          </p>
        )}
      </TypedConfirmDialog>

      <Dialog
        open={offline}
        onOpenChange={(o) => {
          if (!goOffline.isPending) {
            setOffline(o);
            if (!o) setReason('');
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Take {vendor.name} offline</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="offline-reason">Reason (optional, kept in the audit log)</Label>
            <Input id="offline-reason" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOffline(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={goOffline.isPending}
              onClick={() =>
                goOffline.mutate(reason.trim() || undefined, {
                  onSuccess: () => {
                    setOffline(false);
                    setReason('');
                  },
                })
              }
            >
              {goOffline.isPending ? 'Please wait...' : 'Take offline'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
