'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, AlertCircle } from 'lucide-react';
import { Skeleton } from '@water-supply-crm/ui';
import { useDiscrepancyCase, useDiscrepancyAuditLog } from '../hooks/use-discrepancy-cases';
import { ResolveDiscrepancyForm } from './resolve-discrepancy-form';
import { StatusBadge } from '../../../components/shared/status-badge';

function MetaItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">{label}</p>
      <div className="text-sm font-semibold text-foreground dark:text-white">{value}</div>
    </div>
  );
}

function AuditTimeline({ caseId }: { caseId: string }) {
  const { data: logs, isLoading } = useDiscrepancyAuditLog(caseId);

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
          </div>
        </div>
      ))}
    </div>
  );
}

function formatMagnitude(type: string, reportedQuantity?: number | null, reportedAmount?: number | null) {
  if (type === 'CASH') {
    const amt = reportedAmount ?? 0;
    return `₨${Math.abs(amt).toLocaleString()} ${amt > 0 ? 'short' : 'over'}`;
  }
  const qty = reportedQuantity ?? 0;
  return `${qty > 0 ? '+' : ''}${qty} bottle${Math.abs(qty) === 1 ? '' : 's'}`;
}

const RESOLUTION_LABELS: Record<string, string> = {
  CHARGED_TO_DRIVER: 'Charged to Driver',
  COMPANY_LOSS: 'Company Loss',
  WAIVED: 'Waived',
};

interface DiscrepancyCaseDetailProps {
  caseId: string;
}

export function DiscrepancyCaseDetail({ caseId }: DiscrepancyCaseDetailProps) {
  const { data: kase, isLoading, refetch } = useDiscrepancyCase(caseId);
  const [auditOpen, setAuditOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64 rounded-xl" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-48 w-full rounded-2xl" />
      </div>
    );
  }

  if (!kase) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-16">
        <div className="p-4 rounded-2xl bg-destructive/10 border border-destructive/20">
          <AlertCircle className="h-8 w-8 text-destructive" />
        </div>
        <p className="text-sm font-semibold text-muted-foreground">Discrepancy case not found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-foreground dark:text-white">Discrepancy Case</h2>
            <StatusBadge status={kase.status} />
          </div>
          <p className="text-xs text-muted-foreground font-mono">{kase.id}</p>
        </div>
      </div>

      {/* Metadata grid */}
      <div className="rounded-2xl border border-border bg-white/[0.02] p-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <MetaItem label="Type" value={kase.type} />
          <MetaItem label="Reported Gap" value={formatMagnitude(kase.type, kase.reportedQuantity, kase.reportedAmount)} />
          <MetaItem label="Driver" value={kase.driver?.name ?? '—'} />
          <MetaItem label="Van" value={kase.dailySheet?.van?.plateNumber ?? '—'} />
          <MetaItem
            label="Sheet Date"
            value={kase.dailySheet?.date ? new Date(kase.dailySheet.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
          />
          <MetaItem
            label="Reported"
            value={new Date(kase.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
          />
        </div>
      </div>

      {/* Decision section */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Decision</h3>

        <div className="rounded-2xl border border-border bg-white/[0.02] p-6 space-y-4">
          {kase.status === 'REPORTED' && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                This discrepancy has not been resolved yet.
              </p>
              <div>
                <ResolveDiscrepancyForm
                  caseId={caseId}
                  version={kase.version}
                  type={kase.type}
                  reportedAmount={kase.reportedAmount}
                  onSuccess={() => refetch()}
                />
              </div>
            </div>
          )}

          {kase.status === 'RESOLVED' && (
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground">Resolution:</span>
                <span className="text-sm font-bold">
                  {kase.resolutionType ? RESOLUTION_LABELS[kase.resolutionType] ?? kase.resolutionType : '—'}
                </span>
              </div>
              {kase.resolutionAmount != null && (
                <div className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground">Amount:</span>
                  <span className="font-mono font-bold text-emerald-400">
                    &#8360;{kase.resolutionAmount.toLocaleString()}
                  </span>
                </div>
              )}
              {kase.resolvedBy && (
                <p className="text-sm text-muted-foreground">
                  Resolved by {kase.resolvedBy.name}
                  {kase.resolvedAt ? ` on ${new Date(kase.resolvedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}
                </p>
              )}
              {kase.resolutionNote && (
                <p className="text-sm italic text-muted-foreground">&quot;{kase.resolutionNote}&quot;</p>
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
