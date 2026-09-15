'use client';

import { useState } from 'react';
import { CreditCard, Fuel, Inbox, Power } from 'lucide-react';
import { Badge, Button, Card, CardContent, Skeleton, cn } from '@water-supply-crm/ui';
import { useCan } from '../../authz/hooks/use-can';
import { useFuelCards, useUpdateFuelCard } from '../hooks/use-fuel-cards';
import { FUEL_CARD_PERMISSIONS } from '../constants';
import { TopUpFuelCardDialog } from './topup-fuel-card-dialog';
import type { FuelCard as FuelCardRow } from '../api/fuel-card.api';

const money = (n: number) => `₨ ${Number(n ?? 0).toLocaleString()}`;

function FuelCardTile({ card, canManage, canTopUp, onTopUp }: {
  card: FuelCardRow;
  canManage: boolean;
  canTopUp: boolean;
  onTopUp: () => void;
}) {
  const updateCard = useUpdateFuelCard();
  const isNegative = card.balance < 0;

  return (
    <Card className={cn('bg-card/50 border-border/40 rounded-2xl', !card.isActive && 'opacity-60')}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-9 w-9 rounded-xl bg-orange-500/10 text-orange-500 flex items-center justify-center shrink-0">
              <CreditCard className="h-4.5 w-4.5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-black truncate">{card.name}</p>
              <p className="text-[10px] text-muted-foreground truncate">
                {[card.issuer, card.cardNumber].filter(Boolean).join(' · ') || 'No details'}
              </p>
            </div>
          </div>
          {!card.isActive && (
            <Badge variant="secondary" className="text-[10px] font-bold shrink-0">Inactive</Badge>
          )}
        </div>

        <div>
          <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Balance</p>
          <p className={cn('font-mono font-black text-lg tabular-nums', isNegative ? 'text-destructive' : 'text-foreground')}>
            {money(card.balance)}
          </p>
        </div>

        <div className="flex gap-2">
          {canTopUp && card.isActive && (
            <Button size="sm" className="rounded-full font-bold flex-1" onClick={onTopUp}>
              <Fuel className="h-3.5 w-3.5 mr-1.5" />
              Top Up
            </Button>
          )}
          {canManage && (
            <Button
              size="sm"
              variant="outline"
              className="rounded-full font-bold"
              disabled={updateCard.isPending}
              onClick={() => updateCard.mutate({ id: card.id, data: { isActive: !card.isActive } })}
            >
              <Power className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function FuelCardList() {
  const { data: cards, isLoading } = useFuelCards();
  const canManage = useCan(FUEL_CARD_PERMISSIONS.manage);
  const canTopUp = useCan(FUEL_CARD_PERMISSIONS.topup);
  const [topUpTarget, setTopUpTarget] = useState<FuelCardRow | null>(null);

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-36 rounded-2xl" />
        ))}
      </div>
    );
  }

  if (!cards || cards.length === 0) {
    return (
      <Card className="bg-card/30 border-border/40 rounded-2xl">
        <CardContent className="p-10 flex flex-col items-center justify-center gap-3">
          <div className="p-5 rounded-2xl bg-white/[0.01] border border-border">
            <Inbox className="h-8 w-8 text-muted-foreground/40" />
          </div>
          <p className="text-sm font-bold text-muted-foreground/40">No fuel cards registered yet</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {cards.map((card) => (
          <FuelCardTile
            key={card.id}
            card={card}
            canManage={canManage}
            canTopUp={canTopUp}
            onTopUp={() => setTopUpTarget(card)}
          />
        ))}
      </div>

      <TopUpFuelCardDialog
        card={topUpTarget}
        open={!!topUpTarget}
        onOpenChange={(o) => { if (!o) setTopUpTarget(null); }}
      />
    </>
  );
}
