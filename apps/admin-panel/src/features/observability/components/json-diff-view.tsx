'use client';

import { useMemo, useState } from 'react';
import { diffJson, formatDiffValue } from '../lib/json-diff';

const KIND_STYLE = {
  added: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  removed: 'bg-red-500/10 text-red-700 dark:text-red-400',
  changed: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  same: 'text-muted-foreground',
} as const;

interface Props {
  before: unknown;
  after: unknown;
}

/** Before/after diff: two columns at >=768px, stacked on mobile. */
export function JsonDiffView({ before, after }: Props) {
  const [showSame, setShowSame] = useState(false);
  const entries = useMemo(() => diffJson(before, after), [before, after]);
  const changed = entries.filter((e) => e.kind !== 'same');
  const visible = showSame ? entries : changed;

  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">No changes recorded</p>;
  }

  return (
    <div className="space-y-2" data-testid="json-diff">
      <div className="hidden grid-cols-2 gap-2 px-2 text-xs font-semibold uppercase text-muted-foreground md:grid">
        <span>Before</span>
        <span>After</span>
      </div>
      {visible.length === 0 && <p className="text-sm text-muted-foreground">No fields differ</p>}
      <ul className="space-y-1">
        {visible.map((e) => (
          <li key={e.path} data-testid="diff-row" data-kind={e.kind} className={`rounded-md px-2 py-1.5 text-xs ${KIND_STYLE[e.kind]}`}>
            <div className="mb-1 break-all font-mono font-semibold">{e.path}</div>
            <div className="grid gap-1 md:grid-cols-2">
              <div className="break-all font-mono" data-testid="diff-before">
                <span className="font-sans text-[10px] uppercase opacity-70 md:hidden">before: </span>
                {e.kind === 'added' ? '—' : formatDiffValue(e.before)}
              </div>
              <div className="break-all font-mono" data-testid="diff-after">
                <span className="font-sans text-[10px] uppercase opacity-70 md:hidden">after: </span>
                {e.kind === 'removed' ? '—' : formatDiffValue(e.after)}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {entries.length > changed.length && (
        <button type="button" className="text-xs text-primary underline" onClick={() => setShowSame((s) => !s)}>
          {showSame ? 'Hide unchanged fields' : `Show ${entries.length - changed.length} unchanged fields`}
        </button>
      )}
    </div>
  );
}
