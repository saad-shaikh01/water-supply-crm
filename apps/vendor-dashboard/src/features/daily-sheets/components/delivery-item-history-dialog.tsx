'use client';

import {
  Dialog, DialogContent, DialogHeader, DialogTitle, Skeleton,
} from '@water-supply-crm/ui';
import { History } from 'lucide-react';
import { useDeliveryItemHistory } from '../hooks/use-daily-sheets';
import type { DeliveryItemHistoryEntry } from '@water-supply-crm/types';

const ACTION_LABEL: Record<string, string> = {
  DELIVERY_SUBMIT: 'Recorded',
  DELIVERY_EDIT_OVERRIDE: 'Edited',
  DELIVERY_EDIT_UNLOCK: 'Edit Unlocked (Staff)',
  COLLECTION_POLICY_ZERO_CASH: 'Recorded — Zero Cash',
};

const FIELD_LABEL: Record<string, string> = {
  status: 'Status',
  filledDropped: 'Dropped',
  emptyReceived: 'Empties',
  filledReceived: 'Filled Received',
  cashCollected: 'Cash',
};

function formatValue(field: string, value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (field === 'cashCollected') return `₨${Number(value).toLocaleString()}`;
  return String(value);
}

/** Renders the changed fields between an entry's `before`/`after` snapshot —
 * only fields present in both and actually different are shown, so an entry
 * that only ever logs `after` (DELIVERY_SUBMIT) just lists the recorded values. */
function ChangedFields({ entry }: { entry: DeliveryItemHistoryEntry }) {
  const before = entry.changes?.before ?? null;
  const after = entry.changes?.after ?? null;
  if (!after) return null;

  const fields = Object.keys(FIELD_LABEL).filter((f) => f in after);
  if (fields.length === 0) return null;

  return (
    <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1">
      {fields.map((field) => {
        const afterVal = formatValue(field, (after as Record<string, unknown>)[field]);
        const beforeVal = before && field in before ? formatValue(field, (before as Record<string, unknown>)[field]) : null;
        const changed = beforeVal !== null && beforeVal !== afterVal;
        return (
          <div key={field} className="text-[11px]">
            <span className="text-muted-foreground">{FIELD_LABEL[field]}: </span>
            {changed ? (
              <span className="font-mono font-bold">
                <span className="text-muted-foreground line-through decoration-destructive/60">{beforeVal}</span>
                {' → '}
                <span className="text-foreground">{afterVal}</span>
              </span>
            ) : (
              <span className="font-mono font-bold text-foreground">{afterVal}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function HistoryTimeline({ itemId, enabled }: { itemId: string; enabled: boolean }) {
  const { data: entries, isLoading } = useDeliveryItemHistory(itemId, enabled);

  if (isLoading) {
    return (
      <div className="space-y-3 py-4">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
      </div>
    );
  }

  if (!entries?.length) {
    return <p className="text-sm text-muted-foreground py-8 text-center">No history recorded for this delivery yet.</p>;
  }

  return (
    <div className="relative pl-6 space-y-4 py-2">
      <div className="absolute left-2 top-4 bottom-4 w-px bg-border" />
      {entries.map((entry, i) => (
        <div key={entry.id} className="relative">
          <div className={`absolute -left-4 top-1.5 h-2.5 w-2.5 rounded-full border-2 border-background ${i === entries.length - 1 ? 'bg-primary' : 'bg-muted-foreground/40'}`} />
          <div className="rounded-xl border border-border/50 bg-card/50 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-foreground">{ACTION_LABEL[entry.action] ?? entry.action}</span>
              <span className="text-[10px] text-muted-foreground tabular-nums whitespace-nowrap">
                {new Date(entry.createdAt).toLocaleString(undefined, {
                  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                })}
              </span>
            </div>
            {entry.userName && (
              <p className="text-[10px] text-muted-foreground mt-0.5">by {entry.userName}</p>
            )}
            <ChangedFields entry={entry} />
          </div>
        </div>
      ))}
    </div>
  );
}

interface DeliveryItemHistoryDialogProps {
  open: boolean;
  onClose: () => void;
  itemId: string | null;
  customerName?: string;
}

export function DeliveryItemHistoryDialog({ open, onClose, itemId, customerName }: DeliveryItemHistoryDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="rounded-3xl max-w-md max-h-[80dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg font-black flex items-center gap-2">
            <History className="h-4.5 w-4.5 text-primary" />
            Delivery History{customerName ? ` — ${customerName}` : ''}
          </DialogTitle>
        </DialogHeader>
        {itemId && <HistoryTimeline itemId={itemId} enabled={open} />}
      </DialogContent>
    </Dialog>
  );
}
