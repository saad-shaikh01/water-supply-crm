'use client';

import { useState } from 'react';
import { Badge, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Label, Textarea } from '@water-supply-crm/ui';
import { ErrorState } from '../../../components/shared/error-state';
import { useCancelSubscription, useReactivateSubscription, useVendorSubscription } from '../hooks/use-billing';
import { fmtDate, money, subscriptionVariant } from '../lib/billing';
import { StatusBadge } from '../../observability/components/status-badge';
import { UsageBars } from './usage-bars';
import { AssignSubscriptionDialog } from './assign-subscription-dialog';

/** Subscription status for one vendor. Reusable on the vendor detail page. */
export function VendorSubscriptionCard({ vendorId, vendorName }: { vendorId: string; vendorName: string }) {
  const { data, isLoading, error, refetch } = useVendorSubscription(vendorId);
  const cancel = useCancelSubscription();
  const reactivate = useReactivateSubscription();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonErr, setReasonErr] = useState('');
  const [changeOpen, setChangeOpen] = useState(false);

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading subscription...</div>;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (!data) return null;
  const sub = data.subscription;

  const submitCancel = () => {
    if (!reason.trim()) return setReasonErr('A reason is required');
    if (reason.length > 500) return setReasonErr('Max 500 characters');
    cancel.mutate(
      { vendorId, reason: reason.trim() },
      {
        onSuccess: () => {
          setCancelOpen(false);
          setReason('');
        },
      },
    );
  };

  return (
    <div className="space-y-4" data-testid="vendor-subscription">
      {!sub ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">No subscription. This vendor is not subject to plan limits.</p>
          <Button size="sm" onClick={() => setChangeOpen(true)}>
            Assign plan
          </Button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{sub.plan.name}</span>
            <Badge variant={subscriptionVariant[sub.status]} data-status={sub.status}>
              {sub.status.replace('_', ' ')}
            </Badge>
            <span className="text-sm text-muted-foreground">
              {money(sub.plan.price, sub.plan.currency)} / {sub.plan.interval.toLowerCase()}
            </span>
          </div>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-muted-foreground">Current period ends</dt>
            <dd>{fmtDate(sub.currentPeriodEnd)}</dd>
            {sub.trialEndsAt && (
              <>
                <dt className="text-muted-foreground">Trial ends</dt>
                <dd>{fmtDate(sub.trialEndsAt)}</dd>
              </>
            )}
            {sub.cancelReason && (
              <>
                <dt className="text-muted-foreground">Cancel reason</dt>
                <dd>{sub.cancelReason}</dd>
              </>
            )}
          </dl>
          <UsageBars usage={data.usage} limits={data.limits} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setChangeOpen(true)}>
              Change plan / overrides
            </Button>
            {sub.status === 'CANCELLED' ? (
              <Button size="sm" disabled={reactivate.isPending} onClick={() => reactivate.mutate(vendorId)}>
                Reactivate
              </Button>
            ) : (
              <Button size="sm" variant="destructive" onClick={() => setCancelOpen(true)}>
                Cancel subscription
              </Button>
            )}
          </div>
        </>
      )}

      {data.recentInvoices.length > 0 && (
        <div>
          <h4 className="mb-1 text-sm font-medium">Recent invoices</h4>
          <ul className="space-y-1 text-sm">
            {data.recentInvoices.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-2">
                <span>{i.number}</span>
                <span className="text-muted-foreground">{money(i.amount, i.currency)}</span>
                <StatusBadge status={i.status} />
              </li>
            ))}
          </ul>
        </div>
      )}

      <Dialog open={cancelOpen} onOpenChange={(o) => !o && setCancelOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel subscription</DialogTitle>
            <DialogDescription>
              {vendorName}: a cancelled subscription blocks creating new records. It can be reactivated later.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="cancel-reason">Reason</Label>
            <Textarea
              id="cancel-reason"
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setReasonErr('');
              }}
              aria-invalid={!!reasonErr}
            />
            {reasonErr && (
              <p className="text-xs text-destructive" role="alert">
                {reasonErr}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>
              Keep subscription
            </Button>
            <Button variant="destructive" disabled={cancel.isPending} onClick={submitCancel}>
              {cancel.isPending ? 'Cancelling...' : 'Cancel subscription'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AssignSubscriptionDialog open={changeOpen} vendor={{ id: vendorId, name: vendorName }} currentPlanId={sub?.plan.id} onClose={() => setChangeOpen(false)} />
    </div>
  );
}

export function VendorSubscriptionDialog({ vendor, onClose }: { vendor: { id: string; name: string } | null; onClose: () => void }) {
  return (
    <Dialog open={!!vendor} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{vendor?.name} subscription</DialogTitle>
          <DialogDescription>Status, usage against limits and recent invoices.</DialogDescription>
        </DialogHeader>
        {vendor && <VendorSubscriptionCard vendorId={vendor.id} vendorName={vendor.name} />}
      </DialogContent>
    </Dialog>
  );
}
