'use client';

import { 
  CreditCard, 
  MessageSquare, 
  AlertCircle, 
  Zap, 
  DollarSign, 
  ArrowRight,
  ClipboardList,
  Users,
  TrendingUp
} from 'lucide-react';
import Link from 'next/link';
import { Card, CardContent, Skeleton } from '@water-supply-crm/ui';
import { useOverviewStats } from '../hooks/use-dashboard';
import { cn } from '@water-supply-crm/ui';

interface CockpitItemProps {
  label: string;
  value: number | string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  color: string;
  description: string;
}

function CockpitItem({ label, value, icon: Icon, href, color, description }: CockpitItemProps) {
  return (
    <Link href={href}>
      <Card className="hover:bg-accent/50 transition-all border-white/5 bg-white/[0.02] group h-full">
        <CardContent className="p-4 flex flex-col h-full">
          <div className="flex justify-between items-start mb-2">
            <div className={cn("p-2 rounded-lg", color)}>
              <Icon className="h-4 w-4" />
            </div>
            <ArrowRight className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
          <div className="mt-auto">
            <p className="text-2xl font-black tabular-nums">{value}</p>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
            <p className="text-[9px] text-muted-foreground/40 mt-1 line-clamp-1">{description}</p>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

export function OperationsCockpit() {
  const { data, isLoading } = useOverviewStats();

  if (isLoading) {
    return (
      <div className="grid gap-3 grid-cols-2 md:grid-cols-4 lg:grid-cols-8">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
    );
  }

  const stats = (data ?? {}) as any;

  const items = [
    {
      label: "Pending Pay",
      value: stats.pendingPayments ?? 0,
      icon: CreditCard,
      href: "/dashboard/customers?filter=pending-payment",
      color: "bg-amber-500/10 text-amber-500",
      description: "Approval required"
    },
    {
      label: "Open Tickets",
      value: stats.openTickets ?? 0,
      icon: MessageSquare,
      href: "/dashboard/tickets?status=OPEN",
      color: "bg-blue-500/10 text-blue-500",
      description: "Support requests"
    },
    {
      label: "Ops Issues",
      value: stats.openDeliveryIssues ?? 0,
      icon: AlertCircle,
      href: "/dashboard/delivery-issues",
      color: "bg-rose-500/10 text-rose-500",
      description: "Delivery failures"
    },
    {
      label: "On-Demand",
      value: stats.onDemandQueue ?? 0,
      icon: Zap,
      href: "/dashboard/orders?status=APPROVED&dispatch=UNPLANNED",
      color: "bg-indigo-500/10 text-indigo-500",
      description: "Dispatch queue"
    },
    {
      label: "Active Drivers",
      value: stats.totalDrivers ?? 0,
      icon: Users,
      href: "/dashboard/staff",
      color: "bg-emerald-500/10 text-emerald-500",
      description: "Personnel live"
    },
    {
      label: "Sheets Today",
      value: stats.todaySheets ?? 0,
      icon: ClipboardList,
      href: "/dashboard/daily-sheets",
      color: "bg-primary/10 text-primary",
      description: "Daily routes"
    },
    {
      label: "Collections",
      value: `₨${(stats.todayCollections ?? 0).toLocaleString()}`,
      icon: DollarSign,
      href: "/dashboard/transactions",
      color: "bg-emerald-500/10 text-emerald-500",
      description: "Collected today"
    },
    {
      label: "Outstanding",
      value: `₨${Math.round((stats.totalOutstandingBalance ?? 0) / 1000)}k`,
      icon: TrendingUp,
      href: "/dashboard/customers",
      color: "bg-amber-500/10 text-amber-500",
      description: "Total due"
    }
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Operations Cockpit</h3>
      </div>
      <div className="grid gap-3 grid-cols-2 md:grid-cols-4 lg:grid-cols-8">
        {items.map((item) => (
          <CockpitItem key={item.label} {...item} />
        ))}
      </div>
    </div>
  );
}
