'use client';

import { useState, useEffect } from 'react';
import { Button, Input, Label, Card, CardContent, Badge, Skeleton } from '@water-supply-crm/ui';
import { Lock, CheckCircle2 } from 'lucide-react';
import { useDamageCase, useUpdateDamageCase } from '../hooks/use-damage-cases';

interface DamageCaseUpdateFormProps {
  caseId: string;
}

const STATUS_LABELS: Record<string, string> = {
  REPORTED: 'Reported',
  UNDER_REVIEW: 'Under Review',
  CHARGED: 'Charged',
  WAIVED: 'Waived',
  REVERSED: 'Reversed',
};

export function DamageCaseUpdateForm({ caseId }: DamageCaseUpdateFormProps) {
  const { data: damageCase, isLoading, error } = useDamageCase(caseId);
  const { mutate: updateCase, isPending, isSuccess } = useUpdateDamageCase();
  const [bottleCount, setBottleCount] = useState<number>(1);

  useEffect(() => {
    if (damageCase) {
      setBottleCount(damageCase.bottleCount);
    }
  }, [damageCase]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48 rounded-xl" />
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-12 rounded-xl" />
      </div>
    );
  }

  if (error || !damageCase) {
    return (
      <Card className="border-destructive/40 bg-destructive/10">
        <CardContent className="p-6 text-center text-destructive text-sm font-semibold">
          Could not load damage case.
        </CardContent>
      </Card>
    );
  }

  const isEditable = damageCase.status === 'REPORTED';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isEditable) return;
    updateCase({ id: caseId, bottleCount, version: damageCase.version });
  };

  return (
    <div className="space-y-6 max-w-lg">
      {/* Case summary */}
      <Card className="bg-card/40 backdrop-blur-xl border border-white/10 rounded-2xl">
        <CardContent className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Status
            </span>
            <StatusBadge status={damageCase.status} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Severity
            </span>
            {damageCase.severity
              ? <SeverityBadge severity={damageCase.severity} />
              : <span className="text-sm font-semibold text-muted-foreground">—</span>}
          </div>
          {damageCase.customer && (
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                Customer
              </span>
              <span className="text-sm font-semibold text-foreground">{damageCase.customer.name}</span>
            </div>
          )}
          {damageCase.product && (
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                Product
              </span>
              <span className="text-sm font-semibold text-foreground">{damageCase.product.name}</span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Reported
            </span>
            <span className="text-sm text-muted-foreground">
              {new Date(damageCase.createdAt).toLocaleDateString(undefined, {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
            </span>
          </div>
          {damageCase.description && (
            <div className="pt-2 border-t border-border/50">
              <p className="text-xs text-muted-foreground">{damageCase.description}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Read-only lock notice */}
      {!isEditable && (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-card/30 px-4 py-3">
          <Lock className="h-4 w-4 text-muted-foreground shrink-0" />
          <p className="text-sm text-muted-foreground">
            This case is under review and can no longer be edited.
          </p>
        </div>
      )}

      {/* Success notice */}
      {isSuccess && (
        <div className="flex items-center gap-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3">
          <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
          <p className="text-sm text-emerald-300 font-semibold">Updated successfully.</p>
        </div>
      )}

      {/* Edit form */}
      {isEditable && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Bottle Count
            </Label>
            <Input
              type="number"
              min={1}
              value={bottleCount}
              onChange={(e) => setBottleCount(Number(e.target.value))}
              className="h-11"
            />
          </div>

          <Button
            type="submit"
            disabled={isPending || bottleCount < 1}
            className="w-full h-12 rounded-xl font-bold"
          >
            {isPending ? 'Saving...' : 'Update Bottle Count'}
          </Button>
        </form>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colours: Record<string, string> = {
    REPORTED: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    UNDER_REVIEW: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    CHARGED: 'bg-rose-500/20 text-rose-400 border-rose-500/30',
    WAIVED: 'bg-muted text-muted-foreground border-border',
    REVERSED: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  };
  return (
    <Badge className={`text-xs border ${colours[status] ?? ''}`}>
      {STATUS_LABELS[status] ?? status}
    </Badge>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const colours: Record<string, string> = {
    MINOR: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    MODERATE: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    SEVERE: 'bg-rose-500/20 text-rose-400 border-rose-500/30',
  };
  return (
    <Badge className={`text-xs border capitalize ${colours[severity] ?? ''}`}>
      {severity.charAt(0) + severity.slice(1).toLowerCase()}
    </Badge>
  );
}
