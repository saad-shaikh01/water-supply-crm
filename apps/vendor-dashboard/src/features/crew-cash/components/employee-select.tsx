'use client';

import { useMemo } from 'react';
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from '@water-supply-crm/ui';
import { useEligibleEmployees } from '../../payroll/hooks/use-eligible-employees';

export interface CrewCashEmployeeOption {
  id: string;
  name: string;
}

interface EmployeeSelectProps {
  value: string;
  onChange: (employeeId: string) => void;
  /** This sheet's driver + confirmed crew — listed first, under "On this sheet". Everyone else follows. */
  crew?: CrewCashEmployeeOption[];
  /** A person that must stay selectable even if absent from both lists (e.g. an entry's current employee). */
  extra?: CrewCashEmployeeOption | null;
  disabled?: boolean;
  placeholder?: string;
}

/**
 * Employee dropdown for the Daily Sheet's cash-out forms (Crew Cash, and Advance
 * later) — owner request 2026-10-01: cash can go to ANY active employee, not just
 * the van's confirmed crew. The sheet's own crew is still surfaced first because
 * that's who it usually goes to; the rest of the payroll-eligible staff (same
 * list the Payroll "Log Ledger Entry" dialog uses) sits underneath.
 */
export function EmployeeSelect({ value, onChange, crew = [], extra, disabled, placeholder = 'Select employee' }: EmployeeSelectProps) {
  const { data: employees, isLoading } = useEligibleEmployees();

  const { crewList, others } = useMemo(() => {
    const crewIds = new Set(crew.map((c) => c.id));
    const rest = (employees ?? [])
      .filter((e) => !crewIds.has(e.id))
      .map((e) => ({ id: e.id, name: e.name, role: e.role }));
    // `extra` (the current value of an edit) must never vanish from the list.
    const extraMissing = extra && !crewIds.has(extra.id) && !rest.some((r) => r.id === extra.id);
    return {
      crewList: crew,
      others: extraMissing ? [{ id: extra.id, name: extra.name, role: '' }, ...rest] : rest,
    };
  }, [employees, crew, extra]);

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled || (isLoading && crewList.length === 0)}>
      <SelectTrigger className="h-11">
        <SelectValue placeholder={isLoading && crewList.length === 0 ? 'Loading employees…' : placeholder} />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {crewList.length > 0 && (
          <SelectGroup>
            <SelectLabel className="text-[10px] font-black uppercase tracking-widest">On this sheet</SelectLabel>
            {crewList.map((e) => (
              <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
            ))}
          </SelectGroup>
        )}
        {others.length > 0 && (
          <SelectGroup>
            <SelectLabel className="text-[10px] font-black uppercase tracking-widest">
              {crewList.length > 0 ? 'Other staff' : 'Staff'}
            </SelectLabel>
            {others.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                {e.name}
                {e.role && <span className="ml-1 text-xs text-muted-foreground">({e.role.toLowerCase()})</span>}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  );
}
