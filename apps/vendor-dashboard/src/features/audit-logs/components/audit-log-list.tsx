'use client';

import { useMemo, useState } from 'react';
import { useQueryState, parseAsString } from 'nuqs';
import { Eye, FilterX, ArrowRight, User as UserIcon } from 'lucide-react';
import {
  Badge, Button, Card, CardContent,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@water-supply-crm/ui';
import { DataTable } from '../../../components/shared/data-table';
import { DateRangePicker } from '../../../components/shared/date-range-picker';
import { SearchInput } from '../../../components/shared/filters/search-input';
import { CustomerCombobox } from '../../customer-adjustments/components/customer-combobox';
import { useAuditLogs, useAuditFilterOptions } from '../hooks/use-audit-logs';
import { cn } from '@water-supply-crm/ui';

const ACTION_COLORS: Record<string, string> = {
  CREATE:   'bg-emerald-500/10 text-emerald-500',
  UPDATE:   'bg-blue-500/10 text-blue-500',
  DELETE:   'bg-destructive/10 text-destructive',
  APPROVE:  'bg-emerald-500/10 text-emerald-500',
  REJECT:   'bg-destructive/10 text-destructive',
  SUSPEND:  'bg-orange-500/10 text-orange-500',
  ACTIVATE: 'bg-emerald-500/10 text-emerald-500',
  REACTIVATE: 'bg-emerald-500/10 text-emerald-500',
  PRICE_SET: 'bg-violet-500/10 text-violet-500',
  PRICE_REMOVED: 'bg-orange-500/10 text-orange-500',
  BULK_PRICE_UPDATE: 'bg-violet-500/10 text-violet-500',
  RESET_PASSWORD_SELF_SERVICE: 'bg-sky-500/10 text-sky-500',
};

interface AuditChanges {
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  reason?: string;
  [k: string]: unknown;
}

interface AuditLog {
  id: string;
  action: string;
  entity: string;
  entityId?: string | null;
  userId?: string | null;
  userName?: string | null;
  createdAt: string;
  changes?: AuditChanges | null;
}

const label = (s: string) => s.replace(/_/g, ' ');
const fmtRs = (n: unknown) => (typeof n === 'number' ? `₨${n.toLocaleString('en-PK')}` : '—');

/** Customer name recorded on the row's payload, when it carries one. */
function customerNameOf(log: AuditLog): string | undefined {
  const n = log.changes?.after?.customerName ?? log.changes?.before?.customerName;
  return typeof n === 'string' ? n : undefined;
}

function flatten(obj: unknown, prefix = '', out: Record<string, unknown> = {}): Record<string, unknown> {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      flatten(v, prefix ? `${prefix}.${k}` : k, out);
    }
  } else if (prefix) {
    out[prefix] = obj;
  }
  return out;
}

const fmtValue = (v: unknown) =>
  v === undefined ? '—' : v === null ? 'null' : typeof v === 'object' ? JSON.stringify(v) : String(v);

/** Field-by-field before → after rows; unchanged fields are left out. */
function diffRows(changes?: AuditChanges | null) {
  const before = flatten(changes?.before);
  const after = flatten(changes?.after);
  return Array.from(new Set([...Object.keys(before), ...Object.keys(after)]))
    .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    .map((field) => ({ field, before: before[field], after: after[field] }));
}

/** One-line human summary for the list; price rows read "Product ₨400 → ₨500". */
function summaryOf(log: AuditLog): React.ReactNode {
  const b = log.changes?.before;
  const a = log.changes?.after;
  if (typeof a?.price === 'number' || typeof b?.price === 'number') {
    const product = (a?.productName ?? b?.productName) as string | undefined;
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
        {product && <span className="text-muted-foreground">{product}</span>}
        <span className="font-mono">{fmtRs(b?.price)}</span>
        <ArrowRight className="h-3 w-3 text-muted-foreground" />
        <span className="font-mono text-primary">{fmtRs(a?.price)}</span>
      </span>
    );
  }
  if (log.changes?.reason) {
    return <span className="text-xs text-muted-foreground line-clamp-1">{log.changes.reason}</span>;
  }
  return null;
}

export function AuditLogList() {
  const { data, isLoading, page, setPage, limit, setLimit } = useAuditLogs();
  const { data: options } = useAuditFilterOptions();

  const [entity, setEntity] = useQueryState('entity', parseAsString.withDefault(''));
  const [action, setAction] = useQueryState('action', parseAsString.withDefault(''));
  const [userId, setUserId] = useQueryState('userId', parseAsString.withDefault(''));
  const [customerId, setCustomerId] = useQueryState('customerId', parseAsString.withDefault(''));
  const [customerName, setCustomerName] = useQueryState('customerName', parseAsString.withDefault(''));
  const [entityId, setEntityId] = useQueryState('entityId', parseAsString.withDefault(''));
  const [search, setSearch] = useQueryState('search', parseAsString.withDefault(''));
  const [from, setFrom] = useQueryState('from', parseAsString.withDefault(''));
  const [to, setTo] = useQueryState('to', parseAsString.withDefault(''));
  const [viewLog, setViewLog] = useState<AuditLog | null>(null);

  const response = (data as { data?: unknown[]; meta?: { total: number } } | undefined);
  const logs = (response?.data ?? []) as AuditLog[];
  const total = response?.meta?.total ?? 0;

  const hasFilters = !!(entity || action || userId || customerId || entityId || search || from || to);
  const resetPage = () => void setPage(1);

  const clearAll = () => {
    void setEntity(null); void setAction(null); void setUserId(null);
    void setCustomerId(null); void setCustomerName(null); void setEntityId(null);
    void setSearch(null); void setFrom(null); void setTo(null);
    resetPage();
  };

  const setSelect = (setter: (v: string | null) => unknown) => (v: string) => {
    void setter(v === 'all' ? null : v);
    resetPage();
  };

  const diff = useMemo(() => diffRows(viewLog?.changes), [viewLog]);
  // Prefer a name we can show; fall back to what the visible rows say.
  const activeCustomerLabel = customerName || logs.map(customerNameOf).find(Boolean) || 'Selected customer';

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="space-y-3 p-4 bg-card/30 rounded-2xl border border-border/50">
        <div className="flex flex-wrap gap-3 items-start">
          <SearchInput placeholder="Search user, action, entity, id…" onBeforeChange={resetPage} />

          <div className="w-full sm:w-[280px]">
            {customerId ? (
              <div className="flex items-center justify-between gap-2 h-10 px-3 rounded-xl border border-primary/40 bg-primary/5 text-sm">
                <span className="flex items-center gap-2 min-w-0">
                  <UserIcon className="h-4 w-4 text-primary shrink-0" />
                  <span className="font-semibold truncate">{activeCustomerLabel}</span>
                </span>
                <button
                  type="button"
                  aria-label="Remove customer filter"
                  className="text-muted-foreground hover:text-foreground text-xs font-bold"
                  onClick={() => { void setCustomerId(null); void setCustomerName(null); resetPage(); }}
                >
                  ✕
                </button>
              </div>
            ) : (
              <CustomerCombobox
                id="audit-customer-filter"
                value=""
                placeholder="Filter by customer…"
                onChange={(id, name) => {
                  if (!id) return;
                  void setCustomerId(id);
                  void setCustomerName(name);
                  resetPage();
                }}
              />
            )}
          </div>

          <Select value={action || 'all'} onValueChange={setSelect(setAction)}>
            <SelectTrigger className="w-[190px] bg-background/50 border-border/50 rounded-xl">
              <SelectValue placeholder="All Actions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Actions</SelectItem>
              {(options?.actions ?? []).map((a) => <SelectItem key={a} value={a}>{label(a)}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={entity || 'all'} onValueChange={setSelect(setEntity)}>
            <SelectTrigger className="w-[190px] bg-background/50 border-border/50 rounded-xl">
              <SelectValue placeholder="All Entities" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Entities</SelectItem>
              {(options?.entities ?? []).map((e) => <SelectItem key={e} value={e}>{label(e)}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={userId || 'all'} onValueChange={setSelect(setUserId)}>
            <SelectTrigger className="w-[190px] bg-background/50 border-border/50 rounded-xl">
              <SelectValue placeholder="All Users" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Users</SelectItem>
              {(options?.users ?? []).map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
            </SelectContent>
          </Select>

          <div className="w-full sm:w-[240px]">
            <DateRangePicker onChange={resetPage} />
          </div>

          {hasFilters && (
            <Button variant="ghost" size="sm" className="h-10 rounded-xl text-xs font-bold" onClick={clearAll}>
              <FilterX className="h-4 w-4 mr-1.5" /> Clear all
            </Button>
          )}
        </div>

        {entityId && (
          <p className="text-[11px] text-muted-foreground">
            Showing records for entity id <span className="font-mono">{entityId}</span>
          </p>
        )}
      </div>

      <DataTable
        data={logs}
        isLoading={isLoading}
        page={page}
        limit={limit}
        total={total}
        onPageChange={setPage}
        onLimitChange={setLimit}
        emptyMessage={hasFilters ? 'No audit logs match these filters' : 'No audit logs found'}
        tableId="audit-log-list"
        columns={[
          {
            key: 'time', header: 'When',
            essential: true,
            cell: (r) => (
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {new Date(r.createdAt).toLocaleString('en-PK', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </span>
            )
          },
          {
            key: 'action', header: 'Action',
            essential: true,
            cell: (r) => (
              <Badge className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full border-none uppercase", ACTION_COLORS[r.action] ?? 'bg-muted text-muted-foreground')}>
                {label(r.action)}
              </Badge>
            )
          },
          {
            key: 'entity', header: 'Entity',
            cell: (r) => {
              const name = customerNameOf(r);
              return (
                <div>
                  <span className="font-semibold text-sm">{name ?? label(r.entity)}</span>
                  <p className="text-[11px] text-muted-foreground truncate max-w-[160px]">
                    {name ? label(r.entity) : (r.entityId ?? '')}
                  </p>
                </div>
              );
            }
          },
          {
            key: 'summary', header: 'Change',
            cell: (r) => summaryOf(r) ?? <span className="text-xs text-muted-foreground">—</span>
          },
          {
            key: 'user', header: 'By',
            cell: (r) => <span className="text-sm font-medium">{r.userName ?? '—'}</span>
          },
          {
            key: 'actions', header: '', width: '60px',
            essential: true,
            cell: (r) => r.changes ? (
              <Button variant="ghost" size="icon" onClick={() => setViewLog(r)}>
                <Eye className="h-4 w-4" />
              </Button>
            ) : null
          },
        ]}
      />

      {/* Changes Dialog */}
      <Dialog open={!!viewLog} onOpenChange={(o) => { if (!o) setViewLog(null); }}>
        <DialogContent className="rounded-3xl max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Badge className={cn("text-[10px] font-bold px-2 border-none uppercase", ACTION_COLORS[viewLog?.action ?? ''] ?? 'bg-muted text-muted-foreground')}>
                {viewLog ? label(viewLog.action) : ''}
              </Badge>
              {viewLog ? (customerNameOf(viewLog) ?? label(viewLog.entity)) : ''}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>By <strong>{viewLog?.userName ?? 'Unknown'}</strong></span>
              <span>{viewLog?.createdAt ? new Date(viewLog.createdAt).toLocaleString('en-PK') : ''}</span>
            </div>

            {viewLog?.changes?.reason && (
              <p className="text-xs rounded-xl bg-muted/40 px-3 py-2">
                <span className="font-bold uppercase tracking-widest text-[10px] text-muted-foreground mr-2">Reason</span>
                {viewLog.changes.reason}
              </p>
            )}

            {diff.length > 0 && (
              <Card className="bg-accent/20 border-border/30">
                <CardContent className="p-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">What changed</p>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground">
                        <th className="py-1 font-bold">Field</th>
                        <th className="py-1 font-bold">Before</th>
                        <th className="py-1 font-bold">After</th>
                      </tr>
                    </thead>
                    <tbody>
                      {diff.map((d) => (
                        <tr key={d.field} className="border-t border-border/30 align-top">
                          <td className="py-1.5 pr-2 font-semibold">{d.field}</td>
                          <td className="py-1.5 pr-2 font-mono text-muted-foreground break-all">{fmtValue(d.before)}</td>
                          <td className="py-1.5 font-mono text-primary break-all">{fmtValue(d.after)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            )}

            <details className="group">
              <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Raw data
              </summary>
              <pre className="mt-2 text-[11px] font-mono text-foreground overflow-x-auto whitespace-pre-wrap max-h-64">
                {JSON.stringify(viewLog?.changes, null, 2)}
              </pre>
            </details>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
