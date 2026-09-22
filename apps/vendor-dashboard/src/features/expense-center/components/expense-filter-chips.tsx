'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { cn } from '@water-supply-crm/ui';
import { vansApi } from '../../vans/api/vans.api';
import { useEligibleEmployees } from '../../payroll/hooks/use-eligible-employees';
import { useExtraLabourOptions } from '../../extra-labour/hooks/use-extra-labour';
import { cashLedgerCategoryLabel } from '../../van-cash-ledger/hooks/use-cash-ledger-filters';
import { useExpenseCenterTimeline } from '../hooks/use-expense-center';
import { domainMeta, sourceBucketMeta } from '../constants';

function useVanPlate(vanId: string): string {
  const { data } = useQuery({
    queryKey: ['vans', 'dropdown'],
    queryFn: () => vansApi.getAll({ page: 1, limit: 100 }).then((r) => r.data),
    enabled: !!vanId,
    staleTime: 5 * 60 * 1000,
  });
  const vans = (data as { data?: Array<{ id: string; plateNumber: string }> } | undefined)?.data ?? [];
  return useMemo(() => vans.find((v) => v.id === vanId)?.plateNumber ?? 'Selected van', [vans, vanId]);
}

interface Chip { key: string; label: string; onRemove: () => void }

/**
 * Removable chips, one per active Expense timeline filter (domain, category,
 * van, employee, extra labour, payment method, source), with a trailing
 * "Clear all". Renders nothing when no filter is active.
 */
export function ExpenseFilterChips() {
  const {
    domain, setDomain,
    category, setCategory,
    vanId, setVanId,
    employeeId, setEmployeeId,
    extraLabourId, setExtraLabourId,
    paymentMethod, setPaymentMethod,
    source, setSource,
    clearFilters, activeCount,
  } = useExpenseCenterTimeline();

  const needsEmployeeName = !!employeeId;
  const employees = useEligibleEmployees().data;
  const employeeName = useMemo(
    () => (needsEmployeeName ? employees?.find((e) => e.id === employeeId)?.name ?? 'Selected employee' : ''),
    [employees, employeeId, needsEmployeeName],
  );

  const needsLabourName = !!extraLabourId;
  const extraLabourers = useExtraLabourOptions(undefined, undefined, false, extraLabourId, needsLabourName).data;
  const labourName = useMemo(
    () => (needsLabourName ? extraLabourers?.find((l) => l.id === extraLabourId)?.name ?? 'Selected worker' : ''),
    [extraLabourers, extraLabourId, needsLabourName],
  );

  const vanPlate = useVanPlate(vanId);

  if (activeCount === 0) return null;

  const chips: Chip[] = [];
  if (domain) chips.push({ key: 'domain', label: `Domain: ${domainMeta(domain).label}`, onRemove: () => setDomain(null) });
  if (category) chips.push({ key: 'category', label: `Category: ${cashLedgerCategoryLabel(category)}`, onRemove: () => setCategory(null) });
  if (vanId) chips.push({ key: 'van', label: `Van: ${vanPlate}`, onRemove: () => setVanId(null) });
  if (employeeId) chips.push({ key: 'employee', label: `Employee: ${employeeName}`, onRemove: () => setEmployeeId(null) });
  if (extraLabourId) chips.push({ key: 'extraLabour', label: `Extra Labour: ${labourName}`, onRemove: () => setExtraLabourId(null) });
  if (paymentMethod) chips.push({ key: 'paymentMethod', label: `Paid: ${paymentMethod === 'CASH' ? 'Cash' : 'Card / Bank'}`, onRemove: () => setPaymentMethod(null) });
  if (source) chips.push({ key: 'source', label: `Source: ${sourceBucketMeta(source).label}`, onRemove: () => setSource(null) });

  return (
    <div
      className={cn(
        'flex items-center gap-1.5 flex-nowrap overflow-x-auto sm:flex-wrap sm:overflow-visible',
        '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
      )}
      role="group"
      aria-label="Active filters"
    >
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border/60 bg-card/60 pl-3 pr-1 min-h-9 sm:min-h-7 text-[11px] font-semibold text-foreground"
        >
          <span className="max-w-[16rem] truncate">{chip.label}</span>
          <button
            type="button"
            onClick={chip.onRemove}
            aria-label={`Remove filter: ${chip.label}`}
            className="transition-colors inline-flex h-8 w-8 sm:h-6 sm:w-6 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted"
          >
            <X className="h-3 w-3" aria-hidden />
          </button>
        </span>
      ))}

      {chips.length > 0 && (
        <button
          type="button"
          onClick={clearFilters}
          className="transition-colors shrink-0 rounded-full px-3 min-h-9 sm:min-h-7 text-[11px] font-bold text-muted-foreground hover:text-foreground hover:bg-accent/50"
        >
          Clear all
        </button>
      )}
    </div>
  );
}
