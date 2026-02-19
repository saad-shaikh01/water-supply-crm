'use client';

import { useState } from 'react';
import { useQueryState, parseAsString } from 'nuqs';
import { Eye } from 'lucide-react';
import {
  Badge, Button, Card, CardContent,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@water-supply-crm/ui';
import { DataTable } from '../../../components/shared/data-table';
import { useAuditLogs } from '../hooks/use-audit-logs';
import { cn } from '@water-supply-crm/ui';

const ACTION_COLORS: Record<string, string> = {
  CREATE:   'bg-emerald-500/10 text-emerald-500',
  UPDATE:   'bg-blue-500/10 text-blue-500',
  DELETE:   'bg-destructive/10 text-destructive',
  APPROVE:  'bg-emerald-500/10 text-emerald-500',
  REJECT:   'bg-destructive/10 text-destructive',
  SUSPEND:  'bg-orange-500/10 text-orange-500',
  ACTIVATE: 'bg-emerald-500/10 text-emerald-500',
};

const ENTITIES = ['CUSTOMER', 'VAN', 'ROUTE', 'USER', 'PRODUCT', 'EXPENSE', 'DAILY_SHEET', 'TRANSACTION'];
const ACTIONS  = ['CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'SUSPEND', 'ACTIVATE'];

interface AuditLog {
  id: string;
  action: string;
  entity: string;
  entityId: string;
  user?: { name: string };
  createdAt: string;
  changes?: Record<string, unknown>;
}

export function AuditLogList() {
  const { data, isLoading, page, setPage, limit, setLimit } = useAuditLogs();
  const [, setEntity] = useQueryState('entity', parseAsString.withDefault(''));
  const [, setAction] = useQueryState('action', parseAsString.withDefault(''));
  const [viewLog, setViewLog] = useState<AuditLog | null>(null);

  const response = (data as { data?: unknown[]; meta?: { total: number } } | undefined);
  const logs = (response?.data ?? []) as AuditLog[];
  const total = response?.meta?.total ?? 0;

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 p-4 bg-card/30 rounded-2xl border border-border/50">
        <Select defaultValue="all" onValueChange={(v) => setEntity(v === 'all' ? null : v)}>
          <SelectTrigger className="w-[160px] bg-background/50 border-border/50 rounded-xl">
            <SelectValue placeholder="All Entities" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Entities</SelectItem>
            {ENTITIES.map((e) => <SelectItem key={e} value={e}>{e.replace('_', ' ')}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select defaultValue="all" onValueChange={(v) => setAction(v === 'all' ? null : v)}>
          <SelectTrigger className="w-[140px] bg-background/50 border-border/50 rounded-xl">
            <SelectValue placeholder="All Actions" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Actions</SelectItem>
            {ACTIONS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <DataTable
        data={logs}
        isLoading={isLoading}
        page={page}
        limit={limit}
        total={total}
        onPageChange={setPage}
        onLimitChange={setLimit}
        emptyMessage="No audit logs found"
        columns={[
          {
            key: 'action', header: 'Action',
            cell: (r) => (
              <Badge className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full border-none uppercase", ACTION_COLORS[r.action] ?? 'bg-muted text-muted-foreground')}>
                {r.action}
              </Badge>
            )
          },
          {
            key: 'entity', header: 'Entity',
            cell: (r) => (
              <div>
                <span className="font-semibold text-sm">{r.entity.replace('_', ' ')}</span>
                <p className="text-[11px] font-mono text-muted-foreground truncate max-w-[120px]">{r.entityId}</p>
              </div>
            )
          },
          {
            key: 'user', header: 'By',
            cell: (r) => <span className="text-sm font-medium">{r.user?.name ?? '—'}</span>
          },
          {
            key: 'time', header: 'Time',
            cell: (r) => (
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {new Date(r.createdAt).toLocaleString('en-PK', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </span>
            )
          },
          {
            key: 'actions', header: '', width: '60px',
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
                {viewLog?.action}
              </Badge>
              {viewLog?.entity.replace('_', ' ')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>By <strong>{viewLog?.user?.name ?? 'Unknown'}</strong></span>
              <span>{viewLog?.createdAt ? new Date(viewLog.createdAt).toLocaleString() : ''}</span>
            </div>
            <Card className="bg-accent/20 border-border/30">
              <CardContent className="p-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Changes</p>
                <pre className="text-[11px] font-mono text-foreground overflow-x-auto whitespace-pre-wrap max-h-64">
                  {JSON.stringify(viewLog?.changes, null, 2)}
                </pre>
              </CardContent>
            </Card>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
