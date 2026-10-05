'use client';

import { useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Inbox, Wallet } from 'lucide-react';
import { Badge, Button, Card, CardContent, Skeleton, cn } from '@water-supply-crm/ui';
import { useCan } from '../../authz/hooks/use-can';
import { useFuelCardLedger, useFuelCards } from '../hooks/use-fuel-cards';
import { FUEL_CARD_PERMISSIONS } from '../constants';
import { VoidTopUpDialog, type TopUpVoidTarget } from './void-topup-dialog';

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' });

const money = (n: number) => `₨ ${Number(n ?? 0).toLocaleString()}`;

const PAGE_SIZE = 20;

/**
 * Running-balance statement for fuel cards: opening balance, top-ups (credit)
 * and fuel fills paid from the card (debit), each with the card's balance
 * right after it — same "Balance after" idea as the Cash Ledger.
 */
export function TopUpHistoryList() {
  const [cardId, setCardId] = useState<string>('');
  const [page, setPage] = useState(1);
  const { data: cards } = useFuelCards();
  const { data, isLoading } = useFuelCardLedger({
    limit: PAGE_SIZE,
    page,
    ...(cardId && { fuelCardId: cardId }),
  });
  const canVoid = useCan(FUEL_CARD_PERMISSIONS.topupVoid);
  const [voidTarget, setVoidTarget] = useState<TopUpVoidTarget | null>(null);

  const rows = data?.data ?? [];
  const totalPages = data?.meta.totalPages ?? 1;
  const selectCard = (id: string) => {
    setCardId(id);
    setPage(1);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-black uppercase tracking-widest text-muted-foreground">
          Card Ledger
        </h3>
        {(cards?.length ?? 0) > 1 && (
          <div className="flex flex-wrap gap-1.5">
            <Button
              size="sm"
              variant={cardId === '' ? 'default' : 'outline'}
              className="h-7 rounded-full text-[11px] px-3 font-bold"
              onClick={() => selectCard('')}
            >
              All cards
            </Button>
            {cards?.map((c) => (
              <Button
                key={c.id}
                size="sm"
                variant={cardId === c.id ? 'default' : 'outline'}
                className="h-7 rounded-full text-[11px] px-3 font-bold"
                onClick={() => selectCard(c.id)}
              >
                {c.name}
              </Button>
            ))}
          </div>
        )}
      </div>

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
            <p className="text-sm font-bold text-muted-foreground/40">No transactions recorded yet</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => {
            const isFill = row.type === 'FILL';
            const isOpening = row.type === 'OPENING';
            const Icon = isFill ? ArrowUpRight : isOpening ? Wallet : ArrowDownLeft;
            const tone = row.voided
              ? 'text-muted-foreground'
              : isFill
                ? 'text-destructive'
                : 'text-emerald-500';
            const sign = row.voided ? '' : isFill ? '−' : '+';
            return (
              <Card key={row.id} className="bg-card/50 border-border/40 rounded-2xl">
                <CardContent className="p-3 flex items-center gap-3">
                  <div
                    className={cn(
                      'h-8 w-8 rounded-xl flex items-center justify-center shrink-0',
                      row.voided ? 'bg-muted text-muted-foreground' : isFill ? 'bg-destructive/10 text-destructive' : 'bg-emerald-500/10 text-emerald-500',
                    )}
                    aria-hidden
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="secondary" className="text-[10px] font-medium">{row.cardName}</Badge>
                      <Badge variant="secondary" className="text-[10px] font-medium">
                        {isFill ? 'Fuel fill' : isOpening ? 'Opening' : 'Top-up'}
                      </Badge>
                      {row.reference && (
                        <Badge variant="secondary" className="text-[10px] font-mono">{row.reference}</Badge>
                      )}
                      {row.voided && (
                        <Badge className="text-[10px] font-bold px-2 py-0.5 rounded-full border-none bg-destructive/10 text-destructive">
                          VOIDED
                        </Badge>
                      )}
                    </div>
                    <p className={cn('text-xs font-semibold truncate mt-1', row.voided && 'line-through text-muted-foreground')}>
                      {row.description}
                    </p>
                    <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                      {[
                        row.by ? `by ${row.by}` : null,
                        row.voided && row.voidReason ? `voided — ${row.voidReason}` : null,
                      ].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <div className="text-right shrink-0 space-y-0.5">
                    <p className={cn('font-mono font-black text-sm tabular-nums', tone, row.voided && 'line-through opacity-60')}>
                      {sign}{money(row.amount)}
                    </p>
                    <p className="text-[10px] text-muted-foreground">{fmtDate(row.date)}</p>
                    <p className="text-[10px] text-muted-foreground">
                      Balance after{' '}
                      <span className={cn('font-mono font-bold tabular-nums', row.balanceAfter < 0 ? 'text-destructive' : 'text-foreground')}>
                        {money(row.balanceAfter)}
                      </span>
                    </p>
                    {canVoid && row.type === 'TOPUP' && !row.voided && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 rounded-full text-[10px] px-2.5 font-bold text-destructive"
                        onClick={() => setVoidTarget({ id: row.id, amount: row.amount, cardName: row.cardName })}
                      >
                        Void
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 pt-1">
              <Button size="sm" variant="outline" className="rounded-full h-7 text-xs" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <span className="text-xs text-muted-foreground">Page {page} of {totalPages}</span>
              <Button size="sm" variant="outline" className="rounded-full h-7 text-xs" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          )}
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
