'use client';

import { useMemo, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, Badge, Skeleton, cn,
} from '@water-supply-crm/ui';
import { History } from 'lucide-react';
import { useSheetAuditLog } from '../../hooks/use-daily-sheets';
import type { SheetAuditCategory, SheetAuditLogEntry } from '@water-supply-crm/types';

const CATEGORY_STYLE: Record<SheetAuditCategory, string> = {
  CREATE: 'bg-emerald-500/10 text-emerald-500',
  EDIT: 'bg-sky-500/10 text-sky-500',
  CORRECTION: 'bg-amber-500/10 text-amber-600',
  VOID: 'bg-destructive/10 text-destructive',
  DELETE: 'bg-destructive/10 text-destructive',
  CLOSE: 'bg-violet-500/10 text-violet-500',
  CREW: 'bg-blue-500/10 text-blue-500',
  MOVE: 'bg-fuchsia-500/10 text-fuchsia-500',
  ACK: 'bg-teal-500/10 text-teal-500',
  DISCREPANCY: 'bg-orange-500/10 text-orange-600',
  OTHER: 'bg-muted text-muted-foreground',
};

const CATEGORY_LABEL: Record<SheetAuditCategory, string> = {
  CREATE: 'Created', EDIT: 'Edited', CORRECTION: 'Corrections', VOID: 'Voids', DELETE: 'Deletes',
  CLOSE: 'Close', CREW: 'Crew', MOVE: 'Moves', ACK: 'Acknowledgements', DISCREPANCY: 'Cases', OTHER: 'Other',
};

/** Snake/camel key → readable label, plus a light value formatter. */
function labelKey(k: string): string {
  return k
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());
}
function fmt(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return v.toLocaleString();
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

const HIDE_KEYS = new Set(['dailySheetId', 'dailySheetItemId', 'sheetId', 'correctionNote', 'voidNote', 'reason', 'rejectionReason', 'resolutionNote', 'note']);

function ChangedFields({ before, after }: { before: Record<string, unknown> | null; after: Record<string, unknown> | null }) {
  const keys = useMemo(() => {
    const all = new Set<string>([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
    return [...all].filter((k) => !HIDE_KEYS.has(k));
  }, [before, after]);
  if (keys.length === 0) return null;

  return (
    <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1">
      {keys.map((k) => {
        const b = before && k in before ? fmt(before[k]) : null;
        const a = after && k in after ? fmt(after[k]) : null;
        const changed = b !== null && a !== null && b !== a;
        return (
          <div key={k} className="text-[11px] min-w-0">
            <span className="text-muted-foreground">{labelKey(k)}: </span>
            {changed ? (
              <span className="font-mono font-bold">
                <span className="text-muted-foreground line-through decoration-destructive/60">{b}</span>
                {' → '}
                <span className="text-foreground">{a}</span>
              </span>
            ) : (
              <span className="font-mono font-bold text-foreground break-words">{a ?? b ?? '—'}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Timeline({ sheetId, enabled }: { sheetId: string; enabled: boolean }) {
  const { data: entries, isLoading, isError } = useSheetAuditLog(sheetId, enabled);
  const [filter, setFilter] = useState<SheetAuditCategory | 'ALL'>('ALL');

  const categoriesPresent = useMemo(() => {
    const s = new Set<SheetAuditCategory>();
    (entries ?? []).forEach((e) => s.add(e.category));
    return [...s];
  }, [entries]);

  const shown = useMemo(
    () => (entries ?? []).filter((e) => filter === 'ALL' || e.category === filter),
    [entries, filter],
  );

  if (isLoading) {
    return (
      <div className="space-y-3 py-4">
        {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
      </div>
    );
  }
  if (isError) {
    return <p className="text-sm text-destructive py-8 text-center">Failed to load the audit log.</p>;
  }
  if (!entries?.length) {
    return <p className="text-sm text-muted-foreground py-8 text-center">No recorded activity for this sheet yet.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setFilter('ALL')}
          className={cn('px-2 py-0.5 rounded-full text-[11px] font-bold border', filter === 'ALL' ? 'bg-primary/10 text-primary border-primary/30' : 'border-border text-muted-foreground hover:text-foreground')}
        >
          All ({entries.length})
        </button>
        {categoriesPresent.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setFilter(c)}
            className={cn('px-2 py-0.5 rounded-full text-[11px] font-bold border', filter === c ? 'bg-primary/10 text-primary border-primary/30' : 'border-border text-muted-foreground hover:text-foreground')}
          >
            {CATEGORY_LABEL[c]}
          </button>
        ))}
      </div>

      <div className="relative pl-6 space-y-4 py-2">
        <div className="absolute left-2 top-4 bottom-4 w-px bg-border" />
        {shown.map((entry: SheetAuditLogEntry) => (
          <div key={entry.id} className="relative">
            <div className="absolute -left-4 top-1.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-muted-foreground/40" />
            <div className="rounded-xl border border-border/50 bg-card/50 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <span className="text-xs font-bold text-foreground">{entry.actionLabel}</span>
                  <Badge className={cn('ml-2 text-[9px] font-black px-1.5 border-none align-middle', CATEGORY_STYLE[entry.category])}>
                    {entry.entity}
                  </Badge>
                  {entry.entityLabel && (
                    <span className="ml-1.5 text-[11px] text-muted-foreground">{entry.entityLabel}</span>
                  )}
                </div>
                <span className="text-[10px] text-muted-foreground tabular-nums whitespace-nowrap shrink-0">
                  {new Date(entry.at).toLocaleString(undefined, {
                    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
                  })}
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                by {entry.actorName ?? 'Unknown'}{entry.actorRole ? ` · ${entry.actorRole}` : ''}
              </p>
              <ChangedFields before={entry.before} after={entry.after} />
              {entry.reason && (
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  <span className="font-bold">Reason:</span> {entry.reason}
                </p>
              )}
            </div>
          </div>
        ))}
        {shown.length === 0 && (
          <p className="text-xs text-muted-foreground py-4 text-center">No entries in this category.</p>
        )}
      </div>
    </div>
  );
}

interface SheetAuditLogDialogProps {
  open: boolean;
  onClose: () => void;
  sheetId: string;
}

export function SheetAuditLogDialog({ open, onClose, sheetId }: SheetAuditLogDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="rounded-3xl max-w-lg max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg font-black flex items-center gap-2">
            <History className="h-4.5 w-4.5 text-primary" />
            Sheet Audit Log
          </DialogTitle>
        </DialogHeader>
        <Timeline sheetId={sheetId} enabled={open} />
      </DialogContent>
    </Dialog>
  );
}
