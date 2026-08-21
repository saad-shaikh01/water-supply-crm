'use client';

import Link from 'next/link';
import { AlertTriangle, Clock, FileWarning, Wallet } from 'lucide-react';
import { Card, CardContent } from '@water-supply-crm/ui';
import { useFleetOverview } from '../hooks/use-fleet';

/** The four headline numbers from the plan doc §14 — cost/km context lives on each vehicle's own page. */
export function FleetOverviewCards() {
  const { data, isLoading } = useFleetOverview();

  const cards = [
    {
      label: 'Overdue Maintenance',
      value: data?.totalOverdueMaintenance ?? 0,
      icon: AlertTriangle,
      tone: (data?.totalOverdueMaintenance ?? 0) > 0 ? 'text-destructive' : 'text-emerald-500',
      href: '/dashboard/fleet?filter=overdue',
    },
    {
      label: 'Due Soon',
      value: data?.totalDueMaintenance ?? 0,
      icon: Clock,
      tone: (data?.totalDueMaintenance ?? 0) > 0 ? 'text-amber-500' : 'text-emerald-500',
      href: '/dashboard/fleet?filter=due',
    },
    {
      label: 'Documents Expiring (30d)',
      value: data?.expiringDocuments?.length ?? 0,
      icon: FileWarning,
      tone: (data?.expiringDocuments?.length ?? 0) > 0 ? 'text-amber-500' : 'text-emerald-500',
      href: '/dashboard/fleet?filter=documents',
    },
    {
      label: 'Fleet Cost This Month',
      value: `₨${(data?.costThisMonth ?? 0).toLocaleString()}`,
      icon: Wallet,
      tone: 'text-foreground',
      href: undefined,
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => {
        const Icon = card.icon;
        const content = (
          <Card className="rounded-2xl border-border/60">
            <CardContent className="p-5 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{card.label}</p>
                <p className={`text-2xl font-black mt-1 ${isLoading ? 'text-muted-foreground' : card.tone}`}>
                  {isLoading ? '—' : card.value}
                </p>
              </div>
              <Icon className={`h-8 w-8 ${card.tone} opacity-80`} />
            </CardContent>
          </Card>
        );
        return card.href ? (
          <Link key={card.label} href={card.href}>
            {content}
          </Link>
        ) : (
          <div key={card.label}>{content}</div>
        );
      })}

      {!isLoading && data && data.expiringDocuments.length > 0 && (
        <Card className="rounded-2xl border-amber-500/30 bg-amber-500/5 sm:col-span-2 lg:col-span-4">
          <CardContent className="p-5">
            <p className="text-sm font-bold text-amber-500 mb-2">Documents needing attention</p>
            <div className="space-y-1">
              {data.expiringDocuments.slice(0, 5).map((doc) => (
                <Link
                  key={doc.id}
                  href={`/dashboard/fleet/${doc.vehicle.id}`}
                  className="flex items-center justify-between text-sm hover:underline"
                >
                  <span>
                    {doc.vehicle.plateNumber} — {doc.type.replace(/_/g, ' ')}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {doc.expiryDate ? new Date(doc.expiryDate).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                  </span>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
