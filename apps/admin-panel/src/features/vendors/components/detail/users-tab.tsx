'use client';

import { useEffect, useState } from 'react';
import { Badge, Button, Input } from '@water-supply-crm/ui';
import { KeyRound, Search } from 'lucide-react';
import { useVendorUsers } from '../../hooks/use-vendor-detail';
import { useDebounced } from '../../lib/use-debounced';
import { DataTable, type DataTableColumn } from '../../../../components/shared/data-table';
import { ResetAdminPasswordDialog } from './reset-admin-password-dialog';
import type { AdminChoice, VendorRow, VendorUserRow } from '../../types';

/** `role: undefined` = the API default (everyone except customers). Customers are opt-in: there can be thousands. */
const CHIPS: { label: string; role?: string; optional?: boolean }[] = [
  { label: 'Team' },
  { label: 'Admins', role: 'VENDOR_ADMIN' },
  { label: 'Staff', role: 'STAFF' },
  { label: 'Drivers', role: 'DRIVER' },
  { label: 'Salesmen', role: 'SALESMAN', optional: true },
  { label: 'Loaders', role: 'LOADER', optional: true },
  { label: 'Customers', role: 'CUSTOMER' },
];

export function UsersTab({ vendor }: { vendor: VendorRow }) {
  const [role, setRole] = useState<string | undefined>(undefined);
  const [text, setText] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [resetFor, setResetFor] = useState<AdminChoice | null>(null);
  const search = useDebounced(text.trim(), 300);

  useEffect(() => setPage(1), [role, search, limit]);

  const { data, isLoading, error, refetch } = useVendorUsers(vendor.id, { page, limit, role, search: search || undefined });
  const counts = data?.meta?.roleCounts ?? {};

  const columns: DataTableColumn<VendorUserRow>[] = [
    { key: 'name', header: 'Name', className: 'font-medium', cell: (u) => u.name },
    { key: 'email', header: 'Email', cell: (u) => <span className="text-muted-foreground">{u.email ?? '—'}</span> },
    { key: 'role', header: 'Role', cell: (u) => u.roleName ?? u.role },
    { key: 'phone', header: 'Phone', cell: (u) => <span className="text-muted-foreground">{u.phoneNumber ?? '—'}</span> },
    { key: 'status', header: 'Status', cell: (u) => <Badge variant={u.isActive ? 'success' : 'secondary'}>{u.isActive ? 'Active' : 'Inactive'}</Badge> },
    { key: 'created', header: 'Created', cell: (u) => <span className="text-muted-foreground">{new Date(u.createdAt).toLocaleDateString()}</span> },
    {
      key: 'actions',
      header: '',
      className: 'w-[160px]',
      cell: (u) =>
        u.role === 'VENDOR_ADMIN' ? (
          <Button size="sm" variant="outline" aria-label={`Reset password for ${u.email ?? u.name}`} onClick={() => setResetFor({ id: u.id, email: u.email ?? '', name: u.name })}>
            <KeyRound className="mr-1 h-3.5 w-3.5" /> Reset password
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by role">
          {CHIPS.filter((c) => !c.optional || (counts[c.role as string] ?? 0) > 0).map((c) => {
            const active = role === c.role;
            const n = c.role ? counts[c.role] : undefined;
            return (
              <button
                key={c.label}
                type="button"
                aria-pressed={active}
                onClick={() => setRole(c.role)}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${active ? 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'}`}
              >
                {c.label}
                {n !== undefined ? ` (${n})` : ''}
              </button>
            );
          })}
        </div>
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input type="search" aria-label="Search users" placeholder="Search name or email" className="pl-9" value={text} onChange={(e) => setText(e.target.value)} />
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={data?.data ?? []}
        rowKey={(u) => u.id}
        isLoading={isLoading}
        error={error}
        onRetry={() => void refetch()}
        empty={{ title: 'No users found', description: search ? 'No user matches your search.' : 'This group has no users.' }}
        pagination={{ page, limit, total: data?.meta?.total ?? 0, onPageChange: setPage, onLimitChange: setLimit }}
      />

      <ResetAdminPasswordDialog vendorId={vendor.id} vendorName={vendor.name} open={!!resetFor} admin={resetFor} onOpenChange={(o) => !o && setResetFor(null)} />
    </div>
  );
}
