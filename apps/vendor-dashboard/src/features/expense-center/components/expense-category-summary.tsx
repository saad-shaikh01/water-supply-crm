'use client';

import { Fragment, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Skeleton, cn } from '@water-supply-crm/ui';
import { useExpenseCategorySummary } from '../hooks/use-expense-center';
import { domainMeta } from '../constants';
import type { ExpenseCategorySummaryNode } from '../api/expense-center.api';

const money = (value: number | undefined) => (value ? Number(value).toLocaleString() : '—');

const monthLabel = (ym: string) => {
  const [year, month] = ym.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleString('en-US', { month: 'short', year: 'numeric' });
};

const CELL = 'px-3 py-2 text-right font-mono text-xs whitespace-nowrap';
const STICKY = 'sticky left-0 z-10 bg-card';

/**
 * Month-wise spend roll-up: Domain → Category → Subcategory (e.g. Vehicle →
 * Maintenance → Engine Oil). Follows the page's date range and every filter,
 * one column per calendar month in range plus a total. Rows collapse/expand;
 * everything starts expanded so the full breakdown is visible at a glance.
 */
export function ExpenseCategorySummary() {
  const { data, isLoading } = useExpenseCategorySummary();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  if (isLoading) return <Skeleton className="h-64 rounded-2xl" />;
  if (!data) return null;

  if (data.domains.length === 0) {
    return (
      <div className="rounded-2xl bg-card/30 border border-border/40 p-6 text-sm text-muted-foreground">
        No spend recorded for this period and filters.
      </div>
    );
  }

  const monthCells = (node: Pick<ExpenseCategorySummaryNode, 'byMonth' | 'total'>, bold = false) => (
    <>
      {data.months.map((month) => (
        <td key={month} className={cn(CELL, bold && 'font-black', !node.byMonth[month] && 'text-muted-foreground/50')}>
          {money(node.byMonth[month])}
        </td>
      ))}
      <td className={cn(CELL, 'font-black')}>₨ {money(node.total)}</td>
    </>
  );

  return (
    <div className="rounded-2xl border border-border bg-card/30 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th className={cn(STICKY, 'bg-muted/40 px-3 py-2 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground')}>
                Domain / Category
              </th>
              {data.months.map((month) => (
                <th key={month} className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">
                  {monthLabel(month)}
                </th>
              ))}
              <th className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Total</th>
            </tr>
          </thead>
          <tbody>
            {data.domains.map((domain) => {
              const meta = domainMeta(domain.domain);
              const Icon = meta.icon;
              const domainCollapsed = collapsed.has(domain.key);
              return (
                <Fragment key={domain.key}>
                  <tr
                    className="border-b border-border/60 bg-muted/20 cursor-pointer hover:bg-muted/40"
                    onClick={() => toggle(domain.key)}
                  >
                    <td className={cn(STICKY, 'bg-muted/20 px-3 py-2.5')}>
                      <span className="flex items-center gap-2 font-bold">
                        {domainCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs', meta.color)}>
                          <Icon className="h-3.5 w-3.5" />
                          {meta.label}
                        </span>
                      </span>
                    </td>
                    {monthCells(domain, true)}
                  </tr>

                  {!domainCollapsed &&
                    domain.categories.map((category) => {
                      const catKey = `${domain.key}:${category.key}`;
                      const hasSubs = category.subcategories.length > 0;
                      const catCollapsed = collapsed.has(catKey);
                      return (
                        <Fragment key={catKey}>
                          <tr
                            className={cn('border-b border-border/40', hasSubs && 'cursor-pointer hover:bg-muted/30')}
                            onClick={hasSubs ? () => toggle(catKey) : undefined}
                          >
                            <td className={cn(STICKY, 'py-2 pl-8 pr-3')}>
                              <span className="flex items-center gap-1.5 font-semibold">
                                {hasSubs &&
                                  (catCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />)}
                                {category.label}
                              </span>
                            </td>
                            {monthCells(category)}
                          </tr>
                          {hasSubs &&
                            !catCollapsed &&
                            category.subcategories.map((sub) => (
                              <tr key={`${catKey}:${sub.key}`} className="border-b border-border/30 text-muted-foreground">
                                <td className={cn(STICKY, 'py-1.5 pl-16 pr-3 text-xs')}>{sub.label}</td>
                                {monthCells(sub)}
                              </tr>
                            ))}
                        </Fragment>
                      );
                    })}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border bg-muted/40">
              <td className={cn(STICKY, 'bg-muted/40 px-3 py-2.5 font-black uppercase text-xs tracking-wider')}>Grand Total</td>
              {monthCells({ byMonth: data.byMonth, total: data.grandTotal }, true)}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
