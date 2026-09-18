'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { Input, cn } from '@water-supply-crm/ui';
import { useCashLedgerFilters, CASH_LEDGER_MIN_SEARCH } from '../hooks/use-cash-ledger-filters';

const DEBOUNCE_MS = 300;

interface Props {
  /** Table view: the daily table ignores entry filters, so search is inert. */
  disabled?: boolean;
  className?: string;
}

/** True when a modal (Sheet / Dialog) is open — the `/` shortcut must not steal focus from it. */
const modalOpen = (): boolean => !!document.querySelector('[role="dialog"][data-state="open"]');

/**
 * Timeline search. Local input state, debounced (300 ms) into the `q` URL param;
 * only ≥ 2 trimmed characters are ever sent (shorter clears `q`). `/` focuses it
 * (ignored while typing elsewhere). Below `sm` it is an icon button that expands
 * to a full-width input on its own line.
 */
export function CashLedgerSearch({ disabled, className }: Props) {
  const { filters, setFilters } = useCashLedgerFilters();
  const urlQ = filters.q ?? '';

  const [value, setValue] = useState(urlQ);
  // Mobile only: whether the input is expanded (desktop always shows it).
  const [expanded, setExpanded] = useState(!!urlQ);
  // What we last wrote to (or read from) the URL — tells our own writes apart from external changes.
  const lastSent = useRef(urlQ);
  const inputRef = useRef<HTMLInputElement>(null);

  // External change (Clear all, a saved view, chip removal) → mirror it into the input.
  useEffect(() => {
    if (urlQ === lastSent.current) return;
    lastSent.current = urlQ;
    setValue(urlQ);
    if (urlQ) setExpanded(true);
  }, [urlQ]);

  const targetOf = (raw: string): string => {
    const trimmed = raw.trim();
    return trimmed.length >= CASH_LEDGER_MIN_SEARCH ? trimmed : '';
  };

  const commit = useCallback(
    (raw: string) => {
      const target = targetOf(raw);
      if (target === lastSent.current) return;
      lastSent.current = target;
      setFilters({ q: target || undefined });
    },
    [setFilters],
  );

  // 300 ms debounce into the URL.
  useEffect(() => {
    if (targetOf(value) === lastSent.current) return;
    const timer = setTimeout(() => commit(value), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value, commit]);

  const focusSoon = useCallback(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  // `/` focuses the search (unless the user is typing somewhere, or a modal is open).
  useEffect(() => {
    if (disabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (modalOpen()) return;
      e.preventDefault();
      setExpanded(true);
      focusSoon();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [disabled, focusSoon]);

  const clear = () => {
    setValue('');
    commit('');
    inputRef.current?.focus();
  };

  return (
    <>
      {!expanded && (
        <button
          type="button"
          onClick={() => { setExpanded(true); focusSoon(); }}
          disabled={disabled}
          aria-label="Search entries"
          className="sm:hidden inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border/50 bg-background/50 text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors disabled:opacity-50 disabled:pointer-events-none"
        >
          <Search className="h-4 w-4" aria-hidden />
        </button>
      )}

      <div
        className={cn(
          'relative group',
          expanded ? 'w-full order-last' : 'hidden',
          'sm:block sm:order-none sm:w-64 lg:w-72 sm:flex-none',
          disabled && 'opacity-50',
          className,
        )}
      >
        <Search
          className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors pointer-events-none"
          aria-hidden
        />
        <Input
          ref={inputRef}
          type="search"
          inputMode="search"
          value={value}
          disabled={disabled}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit(value);
            else if (e.key === 'Escape') {
              if (value) clear();
              else inputRef.current?.blur();
            }
          }}
          aria-label="Search cash ledger entries"
          placeholder="Search notes, reference, employee, van, sheet…"
          title="Press / to search"
          className="h-11 sm:h-10 pl-9 pr-10 w-full rounded-xl bg-background/50 border-border/50 text-xs font-medium [&::-webkit-search-cancel-button]:hidden"
        />
        {(value || expanded) && !disabled && (
          <button
            type="button"
            onClick={() => (value ? clear() : setExpanded(false))}
            aria-label={value ? 'Clear search' : 'Close search'}
            className={cn(
              'absolute right-1 top-1/2 -translate-y-1/2 inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors',
              !value && 'sm:hidden',
            )}
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
      </div>
    </>
  );
}
