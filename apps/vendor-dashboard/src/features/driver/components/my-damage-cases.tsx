'use client';

import { useRouter } from 'next/navigation';
import { Badge, Card, CardContent, Skeleton } from '@water-supply-crm/ui';
import { Calendar, ChevronRight } from 'lucide-react';
import { useMyDamageCases } from '../hooks/use-damage-cases';
import type { DamageCase } from '../api/damage-case.api';

const STATUS_COLOURS: Record<string, string> = {
  REPORTED: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  UNDER_REVIEW: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  CHARGED: 'bg-rose-500/20 text-rose-400 border-rose-500/30',
  WAIVED: 'bg-muted text-muted-foreground border-border',
  REVERSED: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
};

const STATUS_LABELS: Record<string, string> = {
  REPORTED: 'Reported',
  UNDER_REVIEW: 'Under Review',
  CHARGED: 'Charged',
  WAIVED: 'Waived',
  REVERSED: 'Reversed',
};

const SEVERITY_COLOURS: Record<string, string> = {
  MINOR: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  MODERATE: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  SEVERE: 'bg-rose-500/20 text-rose-400 border-rose-500/30',
};

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function CaseRow({ item }: { item: DamageCase }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.push(`/dashboard/damage-report/${item.id}`)}
      className="w-full text-left"
    >
      <Card className="bg-card/40 backdrop-blur-xl border border-white/10 rounded-2xl hover:border-primary/30 hover:bg-card/60 transition-all">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            {/* Date */}
            <div className="flex items-center gap-1.5 text-muted-foreground shrink-0 w-20">
              <Calendar className="h-3 w-3" />
              <span className="text-xs font-medium">{formatDate(item.createdAt)}</span>
            </div>

            {/* Customer name */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground truncate">
                {item.customer?.name ?? '—'}
              </p>
              {item.product && (
                <p className="text-xs text-muted-foreground truncate">{item.product.name}</p>
              )}
            </div>

            {/* Severity */}
            <Badge
              className={`text-[10px] border shrink-0 capitalize ${SEVERITY_COLOURS[item.severity] ?? ''}`}
            >
              {item.severity.charAt(0) + item.severity.slice(1).toLowerCase()}
            </Badge>

            {/* Bottle count */}
            <span className="text-xs font-mono font-semibold text-foreground shrink-0 w-8 text-right">
              ×{item.bottleCount}
            </span>

            {/* Status */}
            <Badge
              className={`text-[10px] border shrink-0 ${STATUS_COLOURS[item.status] ?? ''}`}
            >
              {STATUS_LABELS[item.status] ?? item.status}
            </Badge>

            <ChevronRight className="h-4 w-4 text-muted-foreground/40 shrink-0" />
          </div>
        </CardContent>
      </Card>
    </button>
  );
}

export function MyDamageCases() {
  const { data, isLoading } = useMyDamageCases({ limit: 50 });

  const cases = data?.data ?? [];

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-2xl" />
        ))}
      </div>
    );
  }

  if (cases.length === 0) {
    return (
      <Card className="bg-card/20 border border-white/5 rounded-2xl">
        <CardContent className="p-8 text-center text-muted-foreground text-sm">
          No damage cases reported yet.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {cases.map((item) => (
        <CaseRow key={item.id} item={item} />
      ))}
    </div>
  );
}
