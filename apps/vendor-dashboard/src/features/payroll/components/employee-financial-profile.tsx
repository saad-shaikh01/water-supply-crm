'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Card, CardContent, CardHeader, CardTitle, Skeleton, Button, Badge,
} from '@water-supply-crm/ui';
import { cn } from '@water-supply-crm/ui';
import {
  ArrowLeft, Wallet, HandCoins, Receipt, Gift, TriangleAlert,
  TrendingUp, TrendingDown, History, FileClock, Info, Landmark, Pencil, Plus, Ban, Link2, ExternalLink,
} from 'lucide-react';
import type { StaffLedgerEntry, SalaryStructure, StaffAdvancePlan } from '@water-supply-crm/types';
import { StatusBadge } from '../../../components/shared/status-badge';
import { DataTable } from '../../../components/shared/data-table';
import { usePermissions } from '../../authz/hooks/use-permissions';
import { useEmployee } from '../hooks/use-employee';
import {
  useEffectiveSalaryStructure, useSalaryHistory, useUnsettledLedgerSummary, useLedgerTimeline,
} from '../hooks/use-employee-profile';
import { useAdvancePlansForEmployee } from '../hooks/use-advance-plans';
import { ledgerCategoryLabel } from '../constants';
import { LogLedgerEntryDialog } from './log-ledger-entry-dialog';
import { SalaryStructureDialog } from './salary-structure-dialog';
import { NewAdvancePlanDialog } from './new-advance-plan-dialog';
import { WriteOffAdvancePlanDialog } from './write-off-advance-plan-dialog';
import { VoidSalaryStructureDialog } from './void-salary-structure-dialog';
import type { CreatableStaffLedgerCategory } from '@water-supply-crm/types';

interface EmployeeFinancialProfileProps {
  employeeId: string;
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * §8 item 6 — every version of this employee's Salary Structure, newest
 * first (matches `useSalaryHistory`'s own `orderBy: effectiveFrom desc`), rendered as
 * a vertical timeline rather than a table so the raise/cut between consecutive
 * versions is legible at a glance. A new version only ever comes from
 * `SalaryStructureDialog` — the one exception is voiding the current row (a
 * data-entry mistake fix, owner-requested 2026-09-25), never an in-place edit.
 * A voided row is shown struck-through with its reason, and — since it can
 * share `effectiveTo: null` with the predecessor it reopened — `isCurrent`
 * explicitly excludes voided rows so only one row is ever marked Current.
 */
function SalaryHistoryTimeline({
  history, isLoading, canVoid, onVoid,
}: {
  history: SalaryStructure[] | undefined;
  isLoading: boolean;
  canVoid: boolean;
  onVoid: (row: SalaryStructure) => void;
}) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-14 w-full rounded-2xl" />
        <Skeleton className="h-14 w-full rounded-2xl" />
      </div>
    );
  }

  if (!history?.length) {
    return <p className="text-sm text-muted-foreground">No salary structure history.</p>;
  }

  return (
    <div className="relative space-y-5 pl-6">
      <div className="absolute left-[7px] top-2 bottom-2 w-px bg-border" />
      {history.map((s, i) => {
        const isVoided = !!s.voidedAt;
        const isCurrent = !s.effectiveTo && !isVoided;
        // `history` is newest-first; the entry right after this one (index i+1) is the
        // older version this one superseded, so the delta is this minus that.
        const previous = history[i + 1];
        const delta = previous ? s.baseAmount - previous.baseAmount : null;

        return (
          <div key={s.id} className={cn('relative', isVoided && 'opacity-60')}>
            <div
              className={cn(
                'absolute -left-6 top-1 h-3.5 w-3.5 rounded-full border-2',
                isCurrent ? 'bg-primary border-primary' : 'bg-background border-border',
              )}
            />
            <div className="flex items-center gap-2 flex-wrap">
              <span className={cn('font-mono font-black text-base', isVoided && 'line-through')}>
                ₨ {s.baseAmount.toLocaleString()}
              </span>
              {isCurrent && (
                <Badge className="text-[10px] font-bold px-2 py-0.5 rounded-full border-none bg-primary/10 text-primary">
                  Current
                </Badge>
              )}
              {isVoided && (
                <Badge variant="outline" className="text-[10px] px-2 py-0.5 rounded-full text-destructive border-destructive/30">
                  Voided
                </Badge>
              )}
              {!isVoided && delta != null && delta !== 0 && (
                <span className={cn('font-mono text-xs font-bold', delta > 0 ? 'text-emerald-500' : 'text-destructive')}>
                  {delta > 0 ? '+' : '−'}₨ {Math.abs(delta).toLocaleString()} from previous
                </span>
              )}
              {!previous && <span className="text-xs text-muted-foreground">Initial</span>}
              {isCurrent && canVoid && (
                <Button
                  variant="ghost" size="sm"
                  className="h-6 gap-1 px-2 text-xs text-destructive hover:text-destructive"
                  onClick={() => onVoid(s)}
                >
                  <Ban className="h-3 w-3" /> Void
                </Button>
              )}
            </div>
            <p className={cn('text-xs text-muted-foreground mt-0.5', isVoided && 'line-through')}>
              {formatDate(s.effectiveFrom)} — {s.effectiveTo ? formatDate(s.effectiveTo) : 'Present'}
            </p>
            {isVoided && s.voidReason && (
              <p className="text-xs text-destructive mt-0.5">Voided: {s.voidReason}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function EmployeeFinancialProfile({ employeeId }: EmployeeFinancialProfileProps) {
  const router = useRouter();
  const { can } = usePermissions();
  const canLogEntry = can('payroll:ledger_create');
  const canManageSalary = can('payroll:salary_structure_manage');
  const canManageAdvancePlans = can('payroll:advance_plan_manage');

  const { data: employee, isLoading: employeeLoading, isError: employeeError } = useEmployee(employeeId);
  const { data: balanceSummary, isLoading: balanceLoading, isError: balanceError } = useUnsettledLedgerSummary(employeeId);
  const { data: effectiveSalary, isLoading: salaryLoading } = useEffectiveSalaryStructure(employeeId);
  const { data: salaryHistory, isLoading: historyLoading } = useSalaryHistory(employeeId);
  const { data: advancePlans, isLoading: advancePlansLoading, isError: advancePlansError } = useAdvancePlansForEmployee(employeeId);

  const [timelinePage, setTimelinePage] = useState(1);
  const [timelineLimit, setTimelineLimit] = useState(20);
  const { data: timeline, isLoading: timelineLoading, isError: timelineError } = useLedgerTimeline(employeeId, {
    page: timelinePage,
    limit: timelineLimit,
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogCategory, setDialogCategory] = useState<CreatableStaffLedgerCategory>('EXPENSE_REIMBURSEMENT');
  const [salaryDialogOpen, setSalaryDialogOpen] = useState(false);
  const [advancePlanDialogOpen, setAdvancePlanDialogOpen] = useState(false);
  const [voidStructureTarget, setVoidStructureTarget] = useState<SalaryStructure | null>(null);
  const [writeOffPlanTarget, setWriteOffPlanTarget] = useState<StaffAdvancePlan | null>(null);

  const openQuickAction = (category: CreatableStaffLedgerCategory) => {
    setDialogCategory(category);
    setDialogOpen(true);
  };

  if (employeeLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-16 bg-muted/30 rounded-2xl w-1/3" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
        </div>
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  if (employeeError || !employee) {
    return (
      <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-8 text-center text-sm text-destructive">
        Failed to load this employee.
      </div>
    );
  }

  const netBalance = balanceSummary?.netBalance ?? 0;
  const isOwedToEmployee = netBalance > 0;

  return (
    <div className="space-y-8 pb-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.back()} className="rounded-full hover:bg-accent group transition-all">
          <ArrowLeft className="h-5 w-5 group-hover:-translate-x-1 transition-transform" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{employee.name}</h1>
            <StatusBadge status={employee.role} />
            {employee.isActive === false && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground border-muted-foreground/30">
                INACTIVE
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground text-sm mt-1">{employee.email}</p>
        </div>
      </div>

      {/* Quick actions (§8 item 8) */}
      {(canLogEntry || canManageAdvancePlans) && (
        <div className="flex flex-wrap gap-3">
          {canManageAdvancePlans && (
            <Button variant="outline" className="rounded-xl font-bold gap-2" onClick={() => setAdvancePlanDialogOpen(true)}>
              <HandCoins className="h-4 w-4" /> New Advance Plan
            </Button>
          )}
          {canLogEntry && (
            <>
              <Button variant="outline" className="rounded-xl font-bold gap-2" onClick={() => openQuickAction('EXPENSE_REIMBURSEMENT')}>
                <Receipt className="h-4 w-4" /> Log Expense / Reimbursement
              </Button>
              <Button variant="outline" className="rounded-xl font-bold gap-2" onClick={() => openQuickAction('BONUS')}>
                <Gift className="h-4 w-4" /> Add Bonus
              </Button>
              <Button variant="outline" className="rounded-xl font-bold gap-2" onClick={() => openQuickAction('PENALTY')}>
                <TriangleAlert className="h-4 w-4" /> Add Penalty / Deduction
              </Button>
            </>
          )}
        </div>
      )}

      {/* §8 items 1-2: current net balance + outstanding advances */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="bg-card/50 backdrop-blur-sm border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
              <Wallet className="h-3 w-3" /> Current Net Balance
            </CardTitle>
          </CardHeader>
          <CardContent>
            {balanceLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : balanceError ? (
              <p className="text-sm text-destructive">Failed to load.</p>
            ) : (
              <>
                <div className={cn('text-2xl font-black font-mono flex items-center gap-2', isOwedToEmployee ? 'text-emerald-500' : netBalance < 0 ? 'text-destructive' : 'text-foreground')}>
                  {isOwedToEmployee ? <TrendingUp className="h-5 w-5" /> : netBalance < 0 ? <TrendingDown className="h-5 w-5" /> : null}
                  ₨ {Math.abs(netBalance).toLocaleString()}
                </div>
                <p className="text-[10px] text-muted-foreground mt-1 font-medium">
                  {isOwedToEmployee ? 'Owed to employee' : netBalance < 0 ? 'Owed by employee' : 'Settled'} — posted, not yet in a locked period
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur-sm border-border/50">
          <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
              <HandCoins className="h-3 w-3" /> Advance Plans
            </CardTitle>
            {canManageAdvancePlans && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 rounded-full"
                onClick={() => setAdvancePlanDialogOpen(true)}
                title="New Advance Plan"
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {advancePlansLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : advancePlansError ? (
              <p className="text-sm text-destructive">Failed to load.</p>
            ) : !advancePlans || advancePlans.length === 0 ? (
              <>
                <div className="text-2xl font-black font-mono text-muted-foreground">₨ 0</div>
                <p className="text-[10px] text-muted-foreground mt-1 font-medium">No advance plans</p>
              </>
            ) : (
              <div className="space-y-2">
                {advancePlans.map((plan) => (
                  <div key={plan.id} className="flex items-center justify-between gap-2 text-[11px]">
                    <div className="min-w-0">
                      <span className="font-semibold text-foreground">₨ {plan.principalAmount.toLocaleString()}</span>
                      <span className="text-muted-foreground"> · {formatDate(plan.disbursedAt)}</span>
                      {plan.status !== 'ACTIVE' && (
                        <Badge variant="outline" className="ml-1.5 text-[9px] px-1 py-0">
                          {plan.status === 'CANCELLED' ? 'Written Off' : plan.status}
                        </Badge>
                      )}
                      {plan.status === 'CANCELLED' && plan.cancelReason && (
                        <p className="text-[10px] text-muted-foreground mt-0.5">{plan.cancelReason}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={cn('font-mono font-semibold', plan.remainingBalance > 0 ? 'text-amber-500' : 'text-muted-foreground')}>
                        ₨ {plan.remainingBalance.toLocaleString()} left
                      </span>
                      {plan.status === 'ACTIVE' && plan.remainingBalance > 0 && canManageAdvancePlans && (
                        <Button
                          variant="ghost" size="icon"
                          className="h-5 w-5 text-destructive hover:text-destructive"
                          title="Write off remaining balance"
                          onClick={() => setWriteOffPlanTarget(plan)}
                        >
                          <Ban className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* §8 item 3: running payroll preview — no per-employee preview endpoint exists yet */}
      <Card className="bg-muted/20 border-border/40">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
            <Info className="h-3 w-3" /> This Month's Running Payroll Preview
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Not yet available — a per-employee live preview endpoint does not exist yet. Draft payroll can be
            generated for the whole period from the Monthly Payroll page.
          </p>
        </CardContent>
      </Card>

      {/* §8 item 4: current salary structure */}
      <Card className="bg-card/50 backdrop-blur-sm border-border/50">
        <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
          <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Current Salary Structure
          </CardTitle>
          {canManageSalary && (
            <Button
              variant="outline"
              size="sm"
              className="rounded-lg h-7 text-xs font-bold gap-1.5"
              onClick={() => setSalaryDialogOpen(true)}
            >
              {effectiveSalary ? <Pencil className="h-3 w-3" /> : <Landmark className="h-3 w-3" />}
              {effectiveSalary ? 'Update Salary' : 'Set Salary'}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {salaryLoading ? (
            <Skeleton className="h-8 w-40" />
          ) : effectiveSalary ? (
            <div className="flex items-center gap-6 flex-wrap">
              <div>
                <p className="text-2xl font-black font-mono">₨ {effectiveSalary.baseAmount.toLocaleString()}</p>
                <p className="text-[10px] text-muted-foreground mt-1 font-medium">{effectiveSalary.payFrequency}</p>
              </div>
              <div className="text-sm text-muted-foreground">
                Effective since {formatDate(effectiveSalary.effectiveFrom)}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No active salary structure on file.</p>
          )}
        </CardContent>
      </Card>

      {/* §8 item 6: salary history — placed directly beneath the current structure card so a
          raise/cut is read in context of what it changed, rather than after the (usually empty,
          §8 item 5) Previous Payroll placeholder. */}
      <Card className="bg-card/50 backdrop-blur-sm border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Salary History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <SalaryHistoryTimeline
            history={salaryHistory}
            isLoading={historyLoading}
            canVoid={canManageSalary}
            onVoid={setVoidStructureTarget}
          />
        </CardContent>
      </Card>

      {/* §8 item 5: previous payroll — no reachable "last locked period for this employee" endpoint */}
      <Card className="bg-muted/20 border-border/40">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
            <FileClock className="h-3 w-3" /> Previous Payroll
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Not yet available — reaching a specific employee's last locked period requires a period id that
            no listing endpoint currently exposes.
          </p>
        </CardContent>
      </Card>

      {/* §8 item 7: financial timeline */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <History className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Financial Timeline</h2>
        </div>
        {timelineError ? (
          <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-6 text-center text-sm text-destructive">
            Failed to load the financial timeline.
          </div>
        ) : (
          <DataTable<StaffLedgerEntry>
            data={timeline?.data}
            isLoading={timelineLoading}
            page={timelinePage}
            limit={timelineLimit}
            total={timeline?.meta.total ?? 0}
            onPageChange={setTimelinePage}
            onLimitChange={(l) => { setTimelineLimit(l); setTimelinePage(1); }}
            emptyMessage="No ledger entries yet"
            tableId="payroll-employee-financial-profile"
            columns={[
              {
                key: 'category', header: 'Category', essential: true,
                cell: (r) => (
                  <div className="flex flex-col gap-1">
                    <span className="font-semibold">{ledgerCategoryLabel(r.category)}</span>
                    {r.linkedCustomer && (
                      <Link
                        href={`/dashboard/customers/${r.linkedCustomer.id}`}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline w-fit"
                      >
                        <Link2 className="h-3 w-3" />
                        {r.linkedCustomer.name} ({r.linkedCustomer.customerCode})
                        <ExternalLink className="h-2.5 w-2.5" />
                      </Link>
                    )}
                  </div>
                ),
              },
              {
                key: 'amount', header: 'Amount',
                cell: (r) => (
                  <span className={cn('font-mono font-bold', r.amount >= 0 ? 'text-emerald-500' : 'text-destructive')}>
                    {r.amount >= 0 ? '+' : '−'}₨ {Math.abs(r.amount).toLocaleString()}
                  </span>
                ),
              },
              { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
              { key: 'effectiveDate', header: 'Date', cell: (r) => formatDate(r.effectiveDate) },
              { key: 'description', header: 'Description', defaultVisible: false, cell: (r) => r.description || '—' },
            ]}
          />
        )}
      </div>

      <LogLedgerEntryDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        employee={{ id: employee.id, name: employee.name }}
        defaultCategory={dialogCategory}
      />

      <SalaryStructureDialog
        employee={salaryDialogOpen ? { id: employee.id, name: employee.name } : null}
        onOpenChange={setSalaryDialogOpen}
      />

      <VoidSalaryStructureDialog
        row={voidStructureTarget}
        employeeId={employee.id}
        onOpenChange={(o) => !o && setVoidStructureTarget(null)}
      />

      <NewAdvancePlanDialog
        employee={advancePlanDialogOpen ? { id: employee.id, name: employee.name } : null}
        onOpenChange={setAdvancePlanDialogOpen}
      />

      <WriteOffAdvancePlanDialog
        plan={writeOffPlanTarget}
        employeeId={employee.id}
        onOpenChange={(o) => !o && setWriteOffPlanTarget(null)}
      />
    </div>
  );
}
