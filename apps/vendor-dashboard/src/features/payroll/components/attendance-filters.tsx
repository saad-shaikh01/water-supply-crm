'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  cn,
} from '@water-supply-crm/ui';
import { Search, X } from 'lucide-react';
import type { AttendanceStatus } from '@water-supply-crm/types';
import type { AttendanceSearchQuery } from '../api/payroll.api';
import { useAttendanceCategories, useAttendanceSearch } from '../hooks/use-attendance';
import { STATUS_META, STATUS_ORDER } from './attendance-grid';

const ANY = '__any__';

interface AttendanceFiltersProps {
  employees: Array<{ id: string; name: string }>;
  /** The currently selected period's bounds — seeds the date range on open. */
  defaultDateFrom: string;
  defaultDateTo: string;
  /**
   * Fires whenever the search result changes, with a `${userId}|${date}` key
   * set the grid can use to highlight matching cells for the current period.
   * `null` means "no active filter" (grid should show everything as usual).
   */
  onMatchingKeysChange: (keys: Set<string> | null) => void;
}

/**
 * Vendor-wide, cross-period attendance report: filter by category / employee
 * / status within a date range (independent of the payroll-period grid
 * above), see the matching rows in a flat table, and a per-employee count
 * summary. Also feeds the grid's cell highlighting via `onMatchingKeysChange`.
 */
export function AttendanceFilters({ employees, defaultDateFrom, defaultDateTo, onMatchingKeysChange }: AttendanceFiltersProps) {
  const { data: categories } = useAttendanceCategories();

  const [categoryId, setCategoryId] = useState<string>(ANY);
  const [userId, setUserId] = useState<string>(ANY);
  const [status, setStatus] = useState<string>(ANY);
  const [dateFrom, setDateFrom] = useState(defaultDateFrom);
  const [dateTo, setDateTo] = useState(defaultDateTo);

  // What was actually searched — only changes on Search/Clear, not every keystroke.
  const [appliedParams, setAppliedParams] = useState<AttendanceSearchQuery>({
    dateFrom: defaultDateFrom,
    dateTo: defaultDateTo,
  });

  const { data: result, isFetching, isError } = useAttendanceSearch(appliedParams, true);

  useEffect(() => {
    if (!result) return;
    onMatchingKeysChange(new Set(result.rows.map((r) => `${r.userId}|${r.date.slice(0, 10)}`)));
    // onMatchingKeysChange is a plain callback prop, not a dep — the parent
    // recreates it every render, which would otherwise refire this pointlessly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  // Tell the grid to stop highlighting once this panel unmounts (filters closed).
  useEffect(() => {
    return () => onMatchingKeysChange(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isValidRange = !!dateFrom && !!dateTo && dateFrom <= dateTo;

  const handleSearch = () => {
    if (!isValidRange) return;
    setAppliedParams({
      dateFrom,
      dateTo,
      categoryId: categoryId === ANY ? undefined : categoryId,
      userId: userId === ANY ? undefined : userId,
      status: status === ANY ? undefined : (status as AttendanceStatus),
    });
  };

  const handleClear = () => {
    setCategoryId(ANY);
    setUserId(ANY);
    setStatus(ANY);
    setDateFrom(defaultDateFrom);
    setDateTo(defaultDateTo);
    setAppliedParams({ dateFrom: defaultDateFrom, dateTo: defaultDateTo });
  };

  const hasNarrowingFilter = !!appliedParams.categoryId || !!appliedParams.userId || !!appliedParams.status;

  const employeeById = useMemo(() => new Map(employees.map((e) => [e.id, e.name])), [employees]);

  return (
    <div className="space-y-3 rounded-2xl border border-border bg-white/[0.02] p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <div className="space-y-1.5">
          <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Category</Label>
          <Select value={categoryId} onValueChange={setCategoryId}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any category</SelectItem>
              {(categories ?? []).map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Employee</Label>
          <Select value={userId} onValueChange={setUserId}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any employee</SelectItem>
              {employees.map((e) => (
                <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Status</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any status</SelectItem>
              {STATUS_ORDER.map((s) => (
                <SelectItem key={s} value={s}>{STATUS_META[s].label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">From</Label>
          <Input type="date" className="h-9" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </div>

        <div className="space-y-1.5">
          <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">To</Label>
          <Input type="date" className="h-9" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button type="button" size="sm" className="gap-1.5 rounded-xl" disabled={!isValidRange} onClick={handleSearch}>
          <Search className="h-3.5 w-3.5" />
          Search
        </Button>
        <Button type="button" variant="ghost" size="sm" className="gap-1.5 rounded-xl" onClick={handleClear}>
          <X className="h-3.5 w-3.5" />
          Clear
        </Button>
        {!isValidRange && <p className="text-xs text-destructive">&quot;From&quot; must be on or before &quot;To&quot;.</p>}
      </div>

      {isError ? (
        <p className="text-sm text-destructive">Failed to load the attendance report.</p>
      ) : isFetching ? (
        <Skeleton className="h-24 rounded-xl" />
      ) : result ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="font-bold">
              {result.summary.totalRows} day{result.summary.totalRows === 1 ? '' : 's'}
            </span>
            <span className="text-muted-foreground">
              across {result.summary.distinctEmployees} employee{result.summary.distinctEmployees === 1 ? '' : 's'}
            </span>
            {result.summary.byEmployee.slice(0, 8).map((e) => (
              <Badge key={e.userId} variant="outline" className="text-xs">
                {employeeById.get(e.userId) ?? e.userName}: {e.count}
              </Badge>
            ))}
          </div>

          {result.rows.length > 0 && (
            <div className="max-h-72 overflow-y-auto rounded-xl border border-border/50">
              <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 bg-muted/60">
                  <tr>
                    <th className="px-3 py-1.5 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Date</th>
                    <th className="px-3 py-1.5 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Employee</th>
                    <th className="px-3 py-1.5 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Status</th>
                    <th className="px-3 py-1.5 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Category</th>
                    <th className="px-3 py-1.5 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((r) => (
                    <tr key={r.id} className="border-t border-border/30">
                      <td className="whitespace-nowrap px-3 py-1.5">{r.date.slice(0, 10)}</td>
                      <td className="px-3 py-1.5">{r.userName}</td>
                      <td className="px-3 py-1.5">
                        <span
                          className={cn(
                            'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-bold',
                            STATUS_META[r.status].className,
                          )}
                        >
                          {STATUS_META[r.status].label}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-muted-foreground">{r.categoryName ?? '—'}</td>
                      <td className="px-3 py-1.5 text-muted-foreground truncate max-w-[16rem]">{r.note ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {result.rows.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No {hasNarrowingFilter ? 'matching' : ''} attendance records in this range.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
