'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Badge, Button } from '@water-supply-crm/ui';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '../../../components/shared/page-header';
import { DataTable, type DataTableColumn } from '../../../components/shared/data-table';
import { ConfirmDialog } from '../../../components/shared/confirm-dialog';
import { NativeSelect } from '../../observability/components/native-select';
import { compactParams, useUrlFilters } from '../../observability/hooks/use-url-filters';
import { apiErrorMessage } from '../../../lib/api-error';
import { announcementsApi, type Announcement } from '../api/announcements.api';
import { useAnnouncements, useCancelAnnouncement, useDeleteAnnouncement, useSendAnnouncement } from '../hooks/use-announcements';
import { EDITABLE, fmtPkt, severityVariant, statusVariant } from '../lib/announcements';
import { ComposerDialog } from './composer-dialog';

const KEYS = ['status'] as const;

export function AnnouncementsPageClient() {
  const url = useUrlFilters(KEYS);
  const params = compactParams({ status: url.values.status, page: url.page, limit: url.limit });
  const { data, isLoading, error, refetch } = useAnnouncements(params);
  const send = useSendAnnouncement();
  const cancel = useCancelAnnouncement();
  const del = useDeleteAnnouncement();
  const [composer, setComposer] = useState<{ open: boolean; announcement: Announcement | null }>({ open: false, announcement: null });
  const [confirm, setConfirm] = useState<{ kind: 'send' | 'cancel' | 'delete'; a: Announcement } | null>(null);

  const edit = async (a: Announcement) => {
    try {
      setComposer({ open: true, announcement: await announcementsApi.get(a.id) });
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Failed to load announcement'));
    }
  };

  const run = () => {
    if (!confirm) return;
    const done = { onSettled: () => setConfirm(null) };
    if (confirm.kind === 'send') send.mutate(confirm.a.id, done);
    else if (confirm.kind === 'cancel') cancel.mutate(confirm.a.id, done);
    else del.mutate(confirm.a.id, done);
  };

  const columns: DataTableColumn<Announcement>[] = [
    {
      key: 'title',
      header: 'Announcement',
      cell: (a) => (
        <div>
          <Link href={`/announcements/${a.id}`} className="font-medium hover:underline">
            {a.title}
          </Link>
          <div className="text-xs text-muted-foreground">by {a.createdByName}</div>
        </div>
      ),
    },
    { key: 'severity', header: 'Severity', cell: (a) => <Badge variant={severityVariant[a.severity]}>{a.severity}</Badge> },
    {
      key: 'audience',
      header: 'Audience',
      cell: (a) => (a.audience === 'ALL_VENDORS' ? 'All vendors' : `${a._count?.vendors ?? 0} selected vendor(s)`),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (a) => (
        <Badge variant={statusVariant[a.status]} data-status={a.status}>
          {a.status}
        </Badge>
      ),
    },
    { key: 'when', header: 'Scheduled / sent', cell: (a) => fmtPkt(a.sentAt ?? a.scheduledFor) },
    { key: 'recipients', header: 'Recipients', cell: (a) => (a.status === 'SENT' || a.status === 'SENDING' ? a.recipientCount : '-') },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      cell: (a) => {
        const editable = EDITABLE.includes(a.status);
        return (
          <div className="flex justify-end gap-2">
            {editable && (
              <Button size="sm" variant="outline" aria-label={`Edit ${a.title}`} onClick={() => edit(a)}>
                Edit
              </Button>
            )}
            {(editable || a.status === 'FAILED') && (
              <Button size="sm" aria-label={`Send ${a.title}`} onClick={() => setConfirm({ kind: 'send', a })}>
                {a.status === 'FAILED' ? 'Retry send' : 'Send now'}
              </Button>
            )}
            {editable && (
              <Button size="sm" variant="ghost" aria-label={`Cancel ${a.title}`} onClick={() => setConfirm({ kind: 'cancel', a })}>
                Cancel
              </Button>
            )}
            {a.status === 'DRAFT' && (
              <Button size="sm" variant="ghost" aria-label={`Delete ${a.title}`} onClick={() => setConfirm({ kind: 'delete', a })}>
                Delete
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  const text = {
    send: { title: 'Send announcement now?', label: 'Send now', desc: (a: Announcement) => `"${a.title}" will be delivered immediately to ${a.audience === 'ALL_VENDORS' ? 'all active vendors' : `${a._count?.vendors ?? 0} selected vendor(s)`}.` },
    cancel: { title: 'Cancel announcement?', label: 'Cancel announcement', desc: (a: Announcement) => `"${a.title}" will not be sent.` },
    delete: { title: 'Delete draft?', label: 'Delete', desc: (a: Announcement) => `"${a.title}" will be permanently deleted.` },
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Announcements"
        description="Messages to vendor admins, delivered through the in-app bell"
        actions={
          <Button onClick={() => setComposer({ open: true, announcement: null })}>
            <Plus className="mr-1 h-4 w-4" /> New announcement
          </Button>
        }
      />
      <div className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
        <NativeSelect aria-label="Filter by status" value={url.values.status} onChange={(e) => url.setFilters({ status: e.target.value })}>
          <option value="">All statuses</option>
          {['DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'CANCELLED', 'FAILED'].map((s) => (
            <option key={s} value={s}>
              {s.charAt(0) + s.slice(1).toLowerCase()}
            </option>
          ))}
        </NativeSelect>
      </div>
      <DataTable
        columns={columns}
        rows={data?.data ?? []}
        rowKey={(a) => a.id}
        isLoading={isLoading}
        error={error}
        onRetry={() => refetch()}
        empty={{ title: 'No announcements', description: 'Compose one to reach your vendors.' }}
        pagination={{ page: url.page, limit: url.limit, total: data?.meta?.total ?? 0, onPageChange: url.setPage, onLimitChange: url.setLimit }}
      />
      <ComposerDialog open={composer.open} announcement={composer.announcement} onClose={() => setComposer({ open: false, announcement: null })} />
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm ? text[confirm.kind].title : ''}
        description={confirm ? text[confirm.kind].desc(confirm.a) : ''}
        confirmLabel={confirm ? text[confirm.kind].label : 'Confirm'}
        isPending={send.isPending || cancel.isPending || del.isPending}
        onConfirm={run}
      />
    </div>
  );
}
