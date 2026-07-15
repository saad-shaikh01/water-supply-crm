'use client';

import { StickyNote } from 'lucide-react';

interface AckGateProps {
  pendingCount: number;
}

/**
 * DriverNoteGate successor (Communication Center Phase 2). The old gate
 * replaced the entire notes panel and hid the composer/thread; the new
 * design keeps the thread fully visible (drivers can now reply) and this
 * component is reduced to the summary banner — each pending instruction's
 * acknowledge action now lives inline on its own MessageBubble.
 */
export function AckGate({ pendingCount }: AckGateProps) {
  if (pendingCount === 0) return null;
  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 flex items-start gap-3">
      <StickyNote className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
      <div>
        <p className="text-sm font-black text-amber-700 dark:text-amber-400">Read Before Delivering</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Acknowledge {pendingCount === 1 ? 'the instruction below' : `all ${pendingCount} instructions below`} to unlock the delivery form.
        </p>
      </div>
    </div>
  );
}
