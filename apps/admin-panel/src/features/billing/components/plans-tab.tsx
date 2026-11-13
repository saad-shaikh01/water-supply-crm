'use client';

import { useState } from 'react';
import { Badge, Button } from '@water-supply-crm/ui';
import { Plus } from 'lucide-react';
import { DataTable, type DataTableColumn } from '../../../components/shared/data-table';
import { ConfirmDialog } from '../../../components/shared/confirm-dialog';
import { useDeletePlan, usePlans, useUpdatePlan } from '../hooks/use-billing';
import { limitText, money } from '../lib/billing';
import type { Plan } from '../api/billing.api';
import { PlanDialog } from './plan-dialog';

export function PlansTab() {
  const { data, isLoading, error, refetch } = usePlans();
  const update = useUpdatePlan();
  const del = useDeletePlan();
  const [editing, setEditing] = useState<Plan | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Plan | null>(null);

  const columns: DataTableColumn<Plan>[] = [
    {
      key: 'name',
      header: 'Plan',
      cell: (p) => (
        <div>
          <div className="font-medium">{p.name}</div>
          {p.description && <div className="text-xs text-muted-foreground">{p.description}</div>}
        </div>
      ),
    },
    { key: 'price', header: 'Price', cell: (p) => `${money(p.price, p.currency)} / ${p.interval.toLowerCase()}` },
    { key: 'trial', header: 'Trial', cell: (p) => (p.trialDays ? `${p.trialDays} days` : '-') },
    { key: 'customers', header: 'Customers', cell: (p) => limitText(p.maxCustomers) },
    { key: 'drivers', header: 'Drivers', cell: (p) => limitText(p.maxDrivers) },
    { key: 'vans', header: 'Vans', cell: (p) => limitText(p.maxVans) },
    { key: 'subs', header: 'Vendors', cell: (p) => p._count?.subscriptions ?? 0 },
    {
      key: 'status',
      header: 'Status',
      cell: (p) => <Badge variant={p.isActive ? 'success' : 'secondary'}>{p.isActive ? 'Active' : 'Inactive'}</Badge>,
    },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      cell: (p) => (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" aria-label={`Edit ${p.name}`} onClick={() => setEditing(p)}>
            Edit
          </Button>
          <Button
            size="sm"
            variant="outline"
            aria-label={`${p.isActive ? 'Deactivate' : 'Activate'} ${p.name}`}
            disabled={update.isPending}
            onClick={() => update.mutate({ id: p.id, body: { isActive: !p.isActive } })}
          >
            {p.isActive ? 'Deactivate' : 'Activate'}
          </Button>
          <Button size="sm" variant="ghost" aria-label={`Delete ${p.name}`} onClick={() => setDeleting(p)}>
            Delete
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setCreating(true)}>
          <Plus className="mr-1 h-4 w-4" /> New plan
        </Button>
      </div>
      <DataTable
        columns={columns}
        rows={data ?? []}
        rowKey={(p) => p.id}
        isLoading={isLoading}
        error={error}
        onRetry={() => refetch()}
        empty={{ title: 'No plans yet', description: 'Create a plan to start assigning subscriptions.' }}
      />
      <PlanDialog
        open={creating || !!editing}
        plan={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete plan ${deleting?.name ?? ''}?`}
        description="A plan that vendors are subscribed to cannot be deleted; deactivate it instead."
        isPending={del.isPending}
        onConfirm={() => deleting && del.mutate(deleting.id, { onSettled: () => setDeleting(null) })}
      />
    </div>
  );
}
