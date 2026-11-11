'use client';

import Link from 'next/link';
import { Badge } from '@water-supply-crm/ui';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '../../../components/shared/page-header';
import { ErrorState } from '../../../components/shared/error-state';
import { DataTable, type DataTableColumn } from '../../../components/shared/data-table';
import { useAnnouncement, useAnnouncementStats } from '../hooks/use-announcements';
import { fmtPkt, readRatePct, severityVariant, statusVariant } from '../lib/announcements';
import type { AnnouncementStats } from '../api/announcements.api';

type VendorRow = AnnouncementStats['byVendor'][number];

function Stat({ label, value, id }: { label: string; value: string | number; id: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold" data-testid={id}>
        {value}
      </div>
    </div>
  );
}

export function AnnouncementDetailClient({ id }: { id: string }) {
  const ann = useAnnouncement(id);
  const delivered = ann.data && ['SENDING', 'SENT', 'FAILED'].includes(ann.data.status);
  const stats = useAnnouncementStats(id, !!delivered);

  if (ann.isLoading) return <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">Loading announcement...</div>;
  if (ann.error || !ann.data) return <ErrorState error={ann.error} onRetry={() => ann.refetch()} />;
  const a = ann.data;

  const columns: DataTableColumn<VendorRow>[] = [
    { key: 'name', header: 'Vendor', cell: (r) => r.name },
    { key: 'delivered', header: 'Delivered', cell: (r) => r.delivered },
    { key: 'read', header: 'Read', cell: (r) => r.read },
    { key: 'rate', header: 'Read rate', cell: (r) => readRatePct(r.delivered ? r.read / r.delivered : 0) },
  ];

  return (
    <div className="space-y-6">
      <Link href="/announcements" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="mr-1 h-4 w-4" /> Back to announcements
      </Link>
      <PageHeader title={a.title} description={`Created by ${a.createdByName}`} />
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={statusVariant[a.status]} data-status={a.status}>
          {a.status}
        </Badge>
        <Badge variant={severityVariant[a.severity]}>{a.severity}</Badge>
        <span className="text-sm text-muted-foreground">
          {a.audience === 'ALL_VENDORS' ? 'All vendors' : `${a.vendors?.length ?? 0} selected vendor(s)`}
        </span>
        {a.scheduledFor && <span className="text-sm text-muted-foreground">Scheduled {fmtPkt(a.scheduledFor)}</span>}
        {a.sentAt && <span className="text-sm text-muted-foreground">Sent {fmtPkt(a.sentAt)}</span>}
      </div>
      <p className="whitespace-pre-wrap rounded-lg border bg-card p-4 text-sm">{a.body}</p>
      {a.lastError && (
        <p className="text-sm text-destructive" role="alert">
          Last error: {a.lastError}
        </p>
      )}
      {a.audience === 'SELECTED_VENDORS' && a.vendors && (
        <div className="flex flex-wrap gap-1">
          {a.vendors.map((v) => (
            <Badge key={v.vendorId} variant="secondary">
              {v.vendor.name}
            </Badge>
          ))}
        </div>
      )}
      {delivered ? (
        stats.error ? (
          <ErrorState error={stats.error} onRetry={() => stats.refetch()} />
        ) : stats.data ? (
          <section className="space-y-3" aria-label="Delivery statistics">
            <div className="grid gap-3 sm:grid-cols-4">
              <Stat id="stat-recipients" label="Recipients" value={stats.data.recipientCount} />
              <Stat id="stat-delivered" label="Delivered" value={stats.data.delivered} />
              <Stat id="stat-read" label="Read" value={stats.data.read} />
              <Stat id="stat-read-rate" label="Read rate" value={readRatePct(stats.data.readRate)} />
            </div>
            <DataTable columns={columns} rows={stats.data.byVendor} rowKey={(r) => r.vendorId} empty={{ title: 'No deliveries yet' }} />
          </section>
        ) : (
          <div className="text-sm text-muted-foreground">Loading statistics...</div>
        )
      ) : (
        <p className="text-sm text-muted-foreground">Statistics are available once the announcement has been sent.</p>
      )}
    </div>
  );
}
