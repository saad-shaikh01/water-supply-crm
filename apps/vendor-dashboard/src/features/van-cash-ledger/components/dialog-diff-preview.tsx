'use client';

import { ArrowRight } from 'lucide-react';

export interface DiffPreviewItem {
  label: string;
  /** Already formatted for display (money / date / label). */
  before: string;
  after: string;
}

interface DialogDiffPreviewProps {
  changes: DiffPreviewItem[];
  className?: string;
}

/**
 * "What will change" panel for edit dialogs. Pass EVERY compared field — only
 * the ones whose before/after differ are rendered, so the caller never has to
 * pre-filter. Before is muted + struck-through, after is emphasised; the arrow
 * keeps the direction readable without relying on colour or strike-through alone.
 */
export function DialogDiffPreview({ changes, className }: DialogDiffPreviewProps) {
  const changed = changes.filter((c) => c.before !== c.after);

  return (
    <div
      className={`rounded-2xl border border-border/50 bg-muted/30 px-3 py-3 ${className ?? ''}`}
      role="status"
      aria-live="polite"
    >
      <p className="font-bold text-xs uppercase tracking-widest text-muted-foreground mb-2">
        What will change
      </p>
      {changed.length === 0 ? (
        <p className="text-sm text-muted-foreground">No changes yet — edit a field above.</p>
      ) : (
        <ul className="space-y-2">
          {changed.map((c) => (
            <li key={c.label} className="text-sm">
              <span className="block text-xs font-bold text-muted-foreground">{c.label}</span>
              <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="text-muted-foreground line-through break-words">{c.before}</span>
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="font-bold text-foreground break-words">{c.after}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
