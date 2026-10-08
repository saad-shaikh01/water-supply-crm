'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  ChevronDown,
  ChevronUp,
  Loader2,
  ClipboardList,
  AlertCircle,
  CalendarDays,
  User as UserIcon,
  Phone,
  MapPin,
  Copy,
  History,
  TriangleAlert,
} from 'lucide-react';
import { Button, Skeleton } from '@water-supply-crm/ui';
import { toast } from 'sonner';
import { useDamageCase, useReviewCase, useAuditLog } from '../hooks/use-damage-cases';
import { DamagePhotoLightbox } from './damage-photo-lightbox';
import { ChargeCaseForm } from './charge-decision-form';
import { WaiveCaseForm } from './waive-decision-form';
import { ReversalButton } from './reversal-button';
import { StatusBadge } from '../../../components/shared/status-badge';

const SEVERITY_COLORS: Record<string, string> = {
  MINOR: 'bg-yellow-500/10 text-yellow-500 border border-yellow-500/20',
  MODERATE: 'bg-orange-500/10 text-orange-500 border border-orange-500/20',
  SEVERE: 'bg-red-500/10 text-red-500 border border-red-500/20',
};

const LOSS_REASON_LABELS: Record<string, string> = {
  CUSTOMER_NOT_RETURNED: "Customer didn't have it",
  CUSTOMER_SAID_LOST: 'Customer said it got lost',
  WRONG_ADDRESS: 'Left at wrong address',
  OTHER: 'Other reason',
};

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

function MetaItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">{label}</p>
      <div className="text-sm font-semibold text-foreground dark:text-white">{value}</div>
    </div>
  );
}

function AuditTimeline({ caseId }: { caseId: string }) {
  const { data: logs, isLoading } = useAuditLog(caseId);

  if (isLoading) {
    return (
      <div className="space-y-3 py-4">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-12 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (!logs?.length) {
    return <p className="text-sm text-muted-foreground py-4 text-center">No audit log entries.</p>;
  }

  return (
    <div className="relative pl-6 space-y-4 py-4">
      <div className="absolute left-2 top-4 bottom-4 w-px bg-border" />
      {logs.map((entry) => (
        <div key={entry.id} className="relative">
          <div className="absolute -left-4 top-1.5 h-2.5 w-2.5 rounded-full bg-primary border-2 border-background" />
          <div className="rounded-xl border border-border bg-white/[0.02] p-3 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-primary">{entry.action}</span>
              <span className="text-[10px] text-muted-foreground tabular-nums">
                {new Date(entry.createdAt).toLocaleString(undefined, {
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>
            {entry.actorName && (
              <p className="text-xs text-muted-foreground">By {entry.actorName}</p>
            )}
            {entry.note && (
              <p className="text-xs italic text-muted-foreground/80">{entry.note}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

interface DamageCaseDetailProps {
  caseId: string;
}

export function DamageCaseDetail({ caseId }: DamageCaseDetailProps) {
  const { data: damageCase, isLoading, refetch } = useDamageCase(caseId);
  const { mutate: reviewCase, isPending: isReviewing } = useReviewCase();
  const [auditOpen, setAuditOpen] = useState(false);

  const handleReview = () => {
    if (!damageCase) return;
    reviewCase(
      { id: caseId, version: damageCase.version },
      {
        onSuccess: () => {
          toast.success('Case is now under review');
          refetch();
        },
      },
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64 rounded-xl" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-48 w-full rounded-2xl" />
      </div>
    );
  }

  if (!damageCase) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-16">
        <div className="p-4 rounded-2xl bg-destructive/10 border border-destructive/20">
          <AlertCircle className="h-8 w-8 text-destructive" />
        </div>
        <p className="text-sm font-semibold text-muted-foreground">Damage case not found.</p>
      </div>
    );
  }

  const hasPhotos = (damageCase.photoUrls?.length ?? 0) > 0;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-foreground dark:text-white">Damage Case</h2>
            <StatusBadge status={damageCase.status} />
          </div>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(damageCase.id);
              toast.success('Case ID copied');
            }}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground font-mono hover:text-foreground"
            title="Copy case ID"
          >
            {damageCase.id}
            <Copy className="h-3 w-3" />
          </button>
        </div>

        {/* Quick links */}
        <div className="flex flex-wrap gap-2">
          {damageCase.dailySheet && (
            <Link href={`/dashboard/daily-sheets/${damageCase.dailySheet.id}`}>
              <Button variant="outline" size="sm" className="rounded-xl gap-1.5 font-semibold">
                <CalendarDays className="h-4 w-4" />
                Daily Sheet ({fmtDate(damageCase.dailySheet.date)})
              </Button>
            </Link>
          )}
          {damageCase.customer && (
            <Link href={`/dashboard/customers/${damageCase.customer.id}`}>
              <Button variant="outline" size="sm" className="rounded-xl gap-1.5 font-semibold">
                <UserIcon className="h-4 w-4" />
                Customer Profile
              </Button>
            </Link>
          )}
          {damageCase.customer?.customerCode && (
            <Link href={`/dashboard/damage-cases?search=${encodeURIComponent(damageCase.customer.customerCode)}`}>
              <Button variant="outline" size="sm" className="rounded-xl gap-1.5 font-semibold">
                <History className="h-4 w-4" />
                All Cases of this Customer
              </Button>
            </Link>
          )}
        </div>
      </div>

      {/* Repeat-customer warning */}
      {(damageCase.customerCaseCount ?? 0) > 0 && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
          <TriangleAlert className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
          <p className="text-sm text-foreground dark:text-white">
            This customer has{' '}
            <span className="font-bold">{damageCase.customerCaseCount}</span> other damage/lost case
            {damageCase.customerCaseCount === 1 ? '' : 's'} on file
            {(damageCase.customerOpenCount ?? 0) > 0 && (
              <>
                {' '}(<span className="font-bold">{damageCase.customerOpenCount}</span> still open)
              </>
            )}
            . Check the history before deciding.
          </p>
        </div>
      )}

      {/* Metadata grid */}
      <div className="rounded-2xl border border-border bg-white/[0.02] p-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <MetaItem
            label="Case Type"
            value={
              damageCase.caseType === 'LOST' ? (
                <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold bg-rose-500/10 text-rose-500 border border-rose-500/20">
                  Lost Bottle
                </span>
              ) : (
                <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-500/10 text-amber-500 border border-amber-500/20">
                  Damage
                </span>
              )
            }
          />
          {damageCase.caseType === 'LOST' && damageCase.lossReason && (
            <MetaItem
              label="Loss Reason"
              value={LOSS_REASON_LABELS[damageCase.lossReason] ?? damageCase.lossReason}
            />
          )}
          <MetaItem
            label="Severity"
            value={
              damageCase.severity ? (
                <span
                  className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold ${SEVERITY_COLORS[damageCase.severity] ?? ''}`}
                >
                  {damageCase.severity}
                </span>
              ) : (
                <span className="text-sm text-muted-foreground">N/A</span>
              )
            }
          />
          <MetaItem label="Bottle Count" value={damageCase.bottleCount} />
          <MetaItem label="Salesman (Reported by)" value={damageCase.salesman?.name ?? '—'} />
          <MetaItem
            label="Customer"
            value={
              damageCase.customer ? (
                <Link
                  href={`/dashboard/customers/${damageCase.customer.id}`}
                  className="hover:text-primary hover:underline"
                >
                  {damageCase.customer.name}
                  {damageCase.customer.customerCode && (
                    <span className="ml-1.5 text-[11px] font-mono text-muted-foreground">
                      {damageCase.customer.customerCode}
                    </span>
                  )}
                </Link>
              ) : (
                '—'
              )
            }
          />
          {damageCase.customer?.phoneNumber && (
            <MetaItem
              label="Phone"
              value={
                <a
                  href={`tel:${damageCase.customer.phoneNumber}`}
                  className="inline-flex items-center gap-1.5 hover:text-primary"
                >
                  <Phone className="h-3.5 w-3.5" />
                  {damageCase.customer.phoneNumber}
                </a>
              }
            />
          )}
          {damageCase.customer?.address && (
            <MetaItem
              label="Address"
              value={
                <span className="inline-flex items-start gap-1.5 font-medium">
                  <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  {damageCase.customer.address}
                </span>
              }
            />
          )}
          <MetaItem label="Van" value={damageCase.van?.plateNumber ?? '—'} />
          <MetaItem
            label="Daily Sheet"
            value={
              damageCase.dailySheet ? (
                <Link
                  href={`/dashboard/daily-sheets/${damageCase.dailySheet.id}`}
                  className="text-primary hover:underline"
                >
                  {fmtDate(damageCase.dailySheet.date)}
                </Link>
              ) : (
                <span className="text-muted-foreground font-normal">Not linked to a sheet</span>
              )
            }
          />
          <MetaItem
            label="Date Reported"
            value={new Date(damageCase.createdAt).toLocaleDateString(undefined, {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })}
          />
          <MetaItem label="Product" value={damageCase.product?.name ?? '—'} />
          {damageCase.reviewedBy && (
            <MetaItem
              label="Reviewed By"
              value={
                <>
                  {damageCase.reviewedBy.name}
                  {damageCase.reviewedAt && (
                    <span className="block text-[11px] font-normal text-muted-foreground">
                      {fmtDate(damageCase.reviewedAt)}
                    </span>
                  )}
                </>
              }
            />
          )}
          {damageCase.chargeAmount != null && (
            <MetaItem
              label="Charge Amount"
              value={
                <span className="font-mono text-emerald-400">
                  &#8360;{damageCase.chargeAmount.toLocaleString()}
                </span>
              }
            />
          )}
        </div>
      </div>

      {/* Salesman's description */}
      {damageCase.description && (
        <div className="space-y-3">
          <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
            Salesman&apos;s Note
          </h3>
          <p className="rounded-2xl border border-border bg-white/[0.02] p-4 text-sm whitespace-pre-wrap">
            {damageCase.description}
          </p>
        </div>
      )}

      {/* Photos */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Photos</h3>
        <DamagePhotoLightbox
          photoKeys={damageCase.photoKeys}
          signedPhotoUrls={damageCase.photoUrls}
        />
      </div>

      {/* Decision section */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Decision</h3>

        <div className="rounded-2xl border border-border bg-white/[0.02] p-6 space-y-4">
          {/* REPORTED: Show "Mark Under Review" */}
          {damageCase.status === 'REPORTED' && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                This case has been reported and is awaiting review.
              </p>
              <div className="flex gap-3 flex-wrap">
                <Button
                  size="sm"
                  onClick={handleReview}
                  disabled={isReviewing}
                  className="rounded-xl font-bold gap-2"
                >
                  {isReviewing && <Loader2 className="h-4 w-4 animate-spin" />}
                  <ClipboardList className="h-4 w-4" />
                  Mark Under Review
                </Button>
              </div>
            </div>
          )}

          {/* UNDER_REVIEW: Show charge + waive forms */}
          {damageCase.status === 'UNDER_REVIEW' && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                This case is under review. Choose a decision:
              </p>
              <div className="flex gap-3 flex-wrap">
                <ChargeCaseForm
                  caseId={caseId}
                  version={damageCase.version}
                  hasPhotos={hasPhotos}
                  caseType={damageCase.caseType}
                  onSuccess={() => refetch()}
                />
                <WaiveCaseForm
                  caseId={caseId}
                  version={damageCase.version}
                  onSuccess={() => refetch()}
                />
              </div>
            </div>
          )}

          {/* CHARGED: Show reversal + charge details */}
          {damageCase.status === 'CHARGED' && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground">Charged:</span>
                <span className="font-mono font-bold text-emerald-400">
                  &#8360;{(damageCase.chargeAmount ?? 0).toLocaleString()}
                </span>
              </div>
              {damageCase.writeOffCategory && (
                <div>
                  <span className="text-sm text-muted-foreground">Write-off Category: </span>
                  <span className="text-sm font-semibold">
                    {damageCase.writeOffCategory.replace(/_/g, ' ')}
                  </span>
                </div>
              )}
              {damageCase.reviewNote && (
                <p className="text-sm italic text-muted-foreground">
                  &quot;{damageCase.reviewNote}&quot;
                </p>
              )}
              <ReversalButton
                caseId={caseId}
                version={damageCase.version}
                chargeAmount={damageCase.chargeAmount ?? 0}
                status={damageCase.status}
                onSuccess={() => refetch()}
              />
            </div>
          )}

          {/* WAIVED */}
          {damageCase.status === 'WAIVED' && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">This charge was waived.</p>
              {damageCase.writeOffCategory && (
                <div>
                  <span className="text-sm text-muted-foreground">Write-off Category: </span>
                  <span className="text-sm font-semibold">
                    {damageCase.writeOffCategory.replace(/_/g, ' ')}
                  </span>
                </div>
              )}
              {damageCase.reviewNote && (
                <p className="text-sm italic text-muted-foreground">
                  Reason: &quot;{damageCase.reviewNote}&quot;
                </p>
              )}
            </div>
          )}

          {/* REVERSED */}
          {damageCase.status === 'REVERSED' && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                The charge of{' '}
                <span className="font-mono font-bold text-foreground dark:text-white">
                  &#8360;{(damageCase.chargeAmount ?? 0).toLocaleString()}
                </span>{' '}
                has been reversed. The customer&apos;s balance was credited.
              </p>
              {damageCase.reviewNote && (
                <p className="text-sm italic text-muted-foreground">
                  Note: &quot;{damageCase.reviewNote}&quot;
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Audit Log (collapsible) */}
      <div className="space-y-2">
        <button
          onClick={() => setAuditOpen((v) => !v)}
          className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
        >
          {auditOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          Audit Log
        </button>

        {auditOpen && (
          <div className="rounded-2xl border border-border bg-white/[0.02] px-4">
            <AuditTimeline caseId={caseId} />
          </div>
        )}
      </div>
    </div>
  );
}
