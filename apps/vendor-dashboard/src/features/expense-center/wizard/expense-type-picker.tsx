'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, Input, Badge, cn,
} from '@water-supply-crm/ui';
import { EXPENSE_TYPE_REGISTRY, type ExpenseTypeEntry } from './expense-types';
import { useRecentExpenseTypes } from './use-recent-expense-types';
import { EXPENSE_CENTER_DOMAINS, domainMeta } from '../constants';

interface ExpenseTypePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (entry: ExpenseTypeEntry) => void;
}

function TypeChip({
  entry,
  onClick,
}: {
  entry: ExpenseTypeEntry;
  onClick: () => void;
}) {
  const Icon = entry.icon;
  const disabled = entry.kind === 'DISABLED';

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      title={disabled ? entry.disabledNote : undefined}
      className={cn(
        'flex flex-col items-center justify-center gap-1.5 rounded-2xl border px-2 py-3 text-center transition-colors min-h-[88px]',
        disabled
          ? 'bg-muted/30 border-border/30 text-muted-foreground/50 cursor-not-allowed'
          : 'bg-background border-border/50 text-foreground hover:bg-muted hover:border-primary/40 cursor-pointer',
      )}
    >
      <Icon className="h-5 w-5" />
      <span className="text-[11px] font-bold leading-tight">{entry.label}</span>
      {disabled && entry.disabledNote && (
        <span className="text-[9px] leading-tight text-muted-foreground/60 line-clamp-2">{entry.disabledNote}</span>
      )}
    </button>
  );
}

/**
 * Step 1 of the Add-Expense wizard — a searchable, domain-grouped chip grid
 * (not a flat `<Select>`) so every real expense category from the design doc
 * stays visible, including the not-yet-wired ones (greyed, with their reason).
 */
export function ExpenseTypePicker({ open, onOpenChange, onSelect }: ExpenseTypePickerProps) {
  const [search, setSearch] = useState('');
  const { recent } = useRecentExpenseTypes();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return EXPENSE_TYPE_REGISTRY;
    return EXPENSE_TYPE_REGISTRY.filter((e) => e.label.toLowerCase().includes(q));
  }, [search]);

  const filteredKeys = useMemo(() => new Set(filtered.map((e) => e.key)), [filtered]);

  const recentEntries = useMemo(
    () =>
      recent
        .map((key) => EXPENSE_TYPE_REGISTRY.find((e) => e.key === key))
        .filter((e): e is ExpenseTypeEntry => !!e && filteredKeys.has(e.key)),
    [recent, filteredKeys],
  );

  const byDomain = useMemo(
    () =>
      EXPENSE_CENTER_DOMAINS
        .map((domain) => ({ domain, entries: filtered.filter((e) => e.domain === domain) }))
        .filter((group) => group.entries.length > 0),
    [filtered],
  );

  const handleSelect = (entry: ExpenseTypeEntry) => {
    if (entry.kind === 'DISABLED') return;
    onSelect(entry);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-3xl max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-black">What are you recording?</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search expense type..."
              className="pl-9 rounded-xl"
              autoFocus
            />
          </div>

          {recentEntries.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Recently Used</p>
              <div className="flex flex-wrap gap-2">
                {recentEntries.map((entry) => {
                  const Icon = entry.icon;
                  return (
                    <button
                      key={entry.key}
                      type="button"
                      onClick={() => handleSelect(entry)}
                      className="flex items-center gap-1.5 rounded-full border border-border/50 bg-background px-3 py-1.5 text-xs font-bold hover:bg-muted transition-colors"
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {entry.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {byDomain.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No expense type matches “{search}”.</p>
          ) : (
            byDomain.map(({ domain, entries }) => {
              const meta = domainMeta(domain);
              return (
                <div key={domain} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full border-none', meta.color)}>
                      {meta.label}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {entries.map((entry) => (
                      <TypeChip key={entry.key} entry={entry} onClick={() => handleSelect(entry)} />
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
