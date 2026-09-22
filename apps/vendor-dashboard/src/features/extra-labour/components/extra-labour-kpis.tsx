import { Card, CardContent, Skeleton } from '@water-supply-crm/ui';
import { UserCheck, UserX, CalendarCheck, Banknote } from 'lucide-react';
import { ExtraLabourSummary } from '../api/extra-labour.api';

interface ExtraLabourKpisProps {
  summary?: ExtraLabourSummary;
  isLoading?: boolean;
}

/** The 4 locked KPI cards: Active Labour / Inactive Labour / Paid This Month / Total Paid. Nothing more. */
export function ExtraLabourKpis({ summary, isLoading }: ExtraLabourKpisProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-28 rounded-xl" />
      </div>
    );
  }

  const formatPKR = (amount: number) =>
    new Intl.NumberFormat('en-PK', {
      style: 'currency',
      currency: 'PKR',
      maximumFractionDigits: 0,
    }).format(amount);

  const cards = [
    {
      key: 'active',
      label: 'Active Labour',
      value: summary?.activeCount ?? 0,
      icon: UserCheck,
      color: 'bg-primary/10 text-primary',
    },
    {
      key: 'inactive',
      label: 'Inactive Labour',
      value: summary?.inactiveCount ?? 0,
      icon: UserX,
      color: 'bg-muted text-muted-foreground',
    },
    {
      key: 'month',
      label: 'Paid This Month',
      value: formatPKR(summary?.paidThisMonth ?? 0),
      icon: CalendarCheck,
      color: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
    },
    {
      key: 'total',
      label: 'Total Paid',
      value: formatPKR(summary?.totalPaid ?? 0),
      icon: Banknote,
      color: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {cards.map(({ key, label, value, icon: Icon, color }) => (
        <Card key={key} className="bg-card shadow-sm border-border">
          <CardContent className="p-4 sm:p-5 flex items-center justify-between">
            <div>
              <p className="text-xs sm:text-sm font-medium text-muted-foreground">{label}</p>
              <h3 className="text-xl sm:text-2xl font-bold tracking-tight mt-1 text-foreground">{value}</h3>
            </div>
            <div className={`p-3 rounded-xl shrink-0 ${color}`}>
              <Icon className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
