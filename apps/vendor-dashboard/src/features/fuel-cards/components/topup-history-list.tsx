'use client';

import { useState } from 'react';
import { Inbox } from 'lucide-react';
import { Badge, Button, Card, CardContent, Skeleton, cn } from '@water-supply-crm/ui';
import { useCan } from '../../authz/hooks/use-can';
import { useFuelCardTopUps } from '../hooks/use-fuel-cards';
import { FUEL_CARD_PERMISSIONS } from '../constants';
import { VoidTopUpDialog, type TopUpVoidTarget } from './void-topup-dialog';

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' });

const money = (n: number) => `₨ ${Number(n ?? 0).toLocaleString()}`;

export function TopUpHistoryList() {
  const { data, isLoading } = useFuelCardTopUps({ limit: 50 });
  const canVoid = useCan(FUEL_CARD_PERMISSIONS.topupVoid);
  const [voidTarget, setVoidTarget] = useState<TopUpVoidTarget | null>(null);

  const rows = data?.data ?? [];

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-black uppercase tracking-widest text-muted-foreground">
        Top-up History
      </h3>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-2xl" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card className="bg-card/30 border-border/40 rounded-2xl">
          <CardContent className="p-10 flex flex-col items-center justify-center gap-3">
            <div className="p-5 rounded-2xl bg-white/[0.01] border border-border">
              <Inbox className="h-8 w-8 text-muted-foreground/40" />
            </div>
            <p className="text-sm font-bold text-muted-foreground/40">No top-ups recorded yet</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => {
            const isVoided = row.status === 'VOIDED';
            return (
              <Card key={row.id} className="bg-card/50 border-border/40 rounded-2xl">
                <CardContent className="p-3 flex items-center gap-3">
                  <span className={cn('h-2.5 w-2.5 rounded-full shrink-0', isVoided ? 'bg-muted-foreground' : 'bg-orange-500')} aria-hidden />
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="secondary" className="text-[10px] font-medium">{row.fuelCard?.name ?? 'Fuel Card'}</Badge>
                      {row.reference && (
                        <Badge variant="secondary" className="text-[10px] font-mono">{row.reference}</Badge>
                      )}
                      {isVoided && (
                        <Badge className="text-[10px] font-bold px-2 py-0.5 rounded-full border-none bg-destructive/10 text-destructive">
                          VOIDED
                        </Badge>
                      )}
                    </div>
                    <p className={cn('text-xs font-semibold truncate mt-1', isVoided && 'line-through text-muted-foreground')}>
                      {row.note || 'Fuel card top-up'}
                    </p>
                    <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                      {[
                        row.createdBy?.name ? `by ${row.createdBy.name}` : null,
                        isVoided && row.voidReason ? `voided — ${row.voidReason}` : null,
                      ].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <div className="text-right shrink-0 space-y-1">
                    <p className={cn('font-mono font-black text-sm text-orange-500', isVoided && 'line-through opacity-60')}>
                      {money(row.amount)}
                    </p>
                    <p className="text-[10px] text-muted-foreground">{fmtDate(row.date)}</p>
                    {canVoid && !isVoided && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 rounded-full text-[10px] px-2.5 font-bold text-destructive"
                        onClick={() => setVoidTarget({ id: row.id, amount: row.amount, cardName: row.fuelCard?.name ?? 'this card' })}
                      >
                        Void
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <VoidTopUpDialog
        target={voidTarget}
        open={!!voidTarget}
        onOpenChange={(o) => { if (!o) setVoidTarget(null); }}
      />
    </div>
  );
}
