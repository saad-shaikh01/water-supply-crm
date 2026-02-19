'use client';

import { useQueryState, parseAsString } from 'nuqs';
import { Input } from '@water-supply-crm/ui';
import { Search } from 'lucide-react';
import { useCallback, useTransition } from 'react';

interface SearchInputProps {
  placeholder?: string;
  paramKey?: string;
}

export function SearchInput({ placeholder = 'Search...', paramKey = 'search' }: SearchInputProps) {
  const [value, setValue] = useQueryState(paramKey, parseAsString.withDefault(''));
  const [, startTransition] = useTransition();

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      startTransition(() => {
        setValue(e.target.value || null);
      });
    },
    [setValue]
  );

  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <Input
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        className="pl-9 w-[200px] lg:w-[300px]"
      />
    </div>
  );
}
