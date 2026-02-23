'use client';

import { useQueryState, parseAsString } from 'nuqs';
import { Input } from '@water-supply-crm/ui';
import { Search, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

interface SearchInputProps {
  placeholder?: string;
  paramKey?: string;
  onBeforeChange?: () => void;
}

export function SearchInput({ placeholder = 'Search...', paramKey = 'search', onBeforeChange }: SearchInputProps) {
  const [query, setQuery] = useQueryState(paramKey, parseAsString.withDefault(''));
  const [localValue, setLocalValue] = useState(query);

  // Sync local state when URL changes (e.g. on navigation or clear)
  useEffect(() => {
    setLocalValue(query);
  }, [query]);

  // Debounce logic: update URL state after 500ms of inactivity
  useEffect(() => {
    const timer = setTimeout(() => {
      if (localValue !== query) {
        onBeforeChange?.();
        setQuery(localValue || null, { shallow: true, scroll: false });
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [localValue, query, setQuery, onBeforeChange]);

  const handleClear = useCallback(() => {
    onBeforeChange?.();
    setLocalValue('');
    setQuery(null);
  }, [setQuery, onBeforeChange]);

  return (
    <div className="relative group max-w-sm">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
      <Input
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        placeholder={placeholder}
        className="pl-9 pr-9 w-full lg:w-[300px] rounded-xl bg-background/50 border-border/50 focus:ring-primary/20 transition-all"
      />
      {localValue && (
        <button
          onClick={handleClear}
          className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded-md hover:bg-muted text-muted-foreground"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
