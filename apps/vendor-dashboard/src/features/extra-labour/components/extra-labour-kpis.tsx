import { Card, CardContent, Skeleton } from '@water-supply-crm/ui';
import { Users, Banknote, CalendarCheck, Tag } from 'lucide-react';
import { ExtraLabourSummary } from '../api/extra-labour.api';

interface ExtraLabourKpisProps {
  summary?: ExtraLabourSummary;
  isLoading?: boolean;
}

export function ExtraLabourKpis({ summary, isLoading }: ExtraLabourKpisProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-28 rounded-xl" />
      </div>
    );
  }

  const activeCount = summary?.activeLabourersCount ?? 0;
  const totalPaid = summary?.totalPaidRange ?? 0;
  const paymentsCount = summary?.paymentsCountRange ?? 0;
  const byType = summary?.byType ?? [];

  const formatPKR = (amount: number) =>
    new Intl.NumberFormat('en-PK', {
      style: 'currency',
      currency: 'PKR',
      maximumFractionDigits: 0,
    }).format(amount);

  return (
    <div className="space-y-4 mb-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card className="bg-card shadow-sm border-border">
          <CardContent className="p-4 sm:p-5 flex items-center justify-between">
            <div>
              <p className="text-xs sm:text-sm font-medium text-muted-foreground">Active Workers</p>
              <h3 className="text-xl sm:text-2xl font-bold tracking-tight mt-1 text-foreground">
                {activeCount}
              </h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">Available for assignment</p>
            </div>
            <div className="p-3 bg-primary/10 text-primary rounded-xl shrink-0">
              <Users className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card shadow-sm border-border">
          <CardContent className="p-4 sm:p-5 flex items-center justify-between">
            <div>
              <p className="text-xs sm:text-sm font-medium text-muted-foreground">Total Payouts</p>
              <h3 className="text-xl sm:text-2xl font-bold tracking-tight mt-1 text-foreground">
                {formatPKR(totalPaid)}
              </h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">Across {paymentsCount} recorded expenses</p>
            </div>
            <div className="p-3 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-xl shrink-0">
              <Banknote className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card shadow-sm border-border sm:col-span-2 lg:col-span-1">
          <CardContent className="p-4 sm:p-5 flex items-center justify-between">
            <div>
              <p className="text-xs sm:text-sm font-medium text-muted-foreground">Payout Transactions</p>
              <h3 className="text-xl sm:text-2xl font-bold tracking-tight mt-1 text-foreground">
                {paymentsCount}
              </h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">Disbursements made</p>
            </div>
            <div className="p-3 bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-xl shrink-0">
              <CalendarCheck className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
          </CardContent>
        </Card>
      </div>

      {byType.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs no-scrollbar">
          <span className="text-muted-foreground font-medium shrink-0 flex items-center gap-1">
            <Tag className="w-3.5 h-3.5" /> By Category:
          </span>
          {byType.map((bt) => (
            <div
              key={bt.labourTypeId}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted/60 border text-foreground shrink-0"
            >
              <span className="font-semibold">{bt.labourTypeName}:</span>
              <span>{bt.count} workers</span>
              <span className="text-muted-foreground">• {formatPKR(bt.totalPaid)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
