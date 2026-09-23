'use client';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@water-supply-crm/ui';
import { EXPENSE_CENTER_DOMAINS, domainMeta } from '../constants';
import { useExpenseCenterTimeline } from '../hooks/use-expense-center';

const ALL = '__all__';

export function ExpenseDomainSelect() {
  const { domain, setDomain } = useExpenseCenterTimeline();

  return (
    <Select value={domain || ALL} onValueChange={(v) => setDomain(v === ALL ? null : v)}>
      <SelectTrigger className="h-11 sm:h-10 w-full sm:w-[170px] rounded-xl bg-background/50 border-border/50">
        <SelectValue placeholder="All Domains" />
      </SelectTrigger>
      <SelectContent className="rounded-xl border-border/50 shadow-2xl">
        <SelectItem value={ALL}>All Domains</SelectItem>
        {EXPENSE_CENTER_DOMAINS.map((d) => (
          <SelectItem key={d} value={d} className="rounded-lg">{domainMeta(d).label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
