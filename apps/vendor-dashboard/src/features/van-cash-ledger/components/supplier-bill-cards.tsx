'use client';

import { useState } from 'react';
import { Card, CardContent, Button, Skeleton, cn } from '@water-supply-crm/ui';
import { Droplets, PackageOpen, Banknote, ChevronDown, ChevronRight, History } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useSupplierBills } from '../hooks/use-van-cash-ledger';
import { useCan } from '../../authz/hooks/use-can';
import { ExpenseForm } from '../../expenses/components/expense-form';
import { SupplierBillOpeningBalanceDialog } from './supplier-bill-opening-balance-dialog';
import type { SupplierBillBucket } from '../api/van-cash-ledger.api';

function fmt(n: number) {
  return `₨${n.toLocaleString('en', { maximumFractionDigits: 0 })}`;
}

function bottleLabel(n: number) {
  return `${n.toLocaleString()} bottle${n === 1 ? '' : 's'}`;
}

interface BillCardProps {
  title: string;
  icon: typeof Droplets;
  bucket: SupplierBillBucket;
  canPay: boolean;
  onPay: () => void;
}

/** Collapsed by default — the header alone (title + total pending + Pay) is
 *  enough for a glance; expanding reveals the full prev/current breakdown
 *  including how many bottles each amount is actually for (owner request
 *  2026-09-23). */
function BillCard({ title, icon: Icon, bucket, canPay, onPay }: BillCardProps) {
  const [expanded, setExpanded] = useState(false);
  const nothingOwed = bucket.totalPending <= 0;

  return (
    <Card className="bg-card/40 backdrop-blur-xl border-white/10 rounded-[2rem]">
      <CardContent className="pt-6 space-y-4">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          className="w-full flex items-center justify-between gap-2 text-left"
        >
          <div className="flex items-center gap-2 min-w-0">
            <div className="p-2 rounded-xl bg-primary/10 shrink-0">
              <Icon className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="font-bold text-sm">{title}</p>
              <p className={cn('text-xs font-mono font-bold', bucket.totalPending > 0 ? 'text-rose-400' : 'text-emerald-400')}>
                {fmt(bucket.totalPending)} pending
              </p>
            </div>
          </div>
          <span className="p-1.5 rounded-lg text-muted-foreground shrink-0">
            {expanded ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
          </span>
        </button>

        {expanded && (
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">Prev Months Pending</p>
              <p className={cn('text-base font-black font-mono mt-0.5', bucket.prevMonthPending > 0 ? 'text-rose-400' : 'text-emerald-400')}>
                {fmt(bucket.prevMonthPending)}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{bottleLabel(bucket.prevMonthBottles)} sold</p>
              {bucket.openingBalance > 0 && (
                <p className="text-[10px] text-muted-foreground mt-0.5">incl. {fmt(bucket.openingBalance)} opening balance</p>
              )}
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">This Month Pending</p>
              <p className={cn('text-base font-black font-mono mt-0.5', bucket.currentMonthPending > 0 ? 'text-rose-400' : 'text-emerald-400')}>
                {fmt(bucket.currentMonthPending)}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">of {fmt(bucket.currentMonthBill)} this month&apos;s bill</p>
            </div>
            <div className="col-span-2">
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">This Month&apos;s Bill</p>
              <p className="text-base font-black font-mono mt-0.5">{fmt(bucket.currentMonthBill)}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{bottleLabel(bucket.currentMonthBottles)} sold this month</p>
            </div>
          </div>
        )}

        {canPay && (
          <Button
            size="sm"
            variant={nothingOwed ? 'outline' : 'default'}
            disabled={nothingOwed}
            onClick={onPay}
            className="w-full rounded-xl font-bold gap-1.5"
          >
            <Banknote className="h-3.5 w-3.5" /> Pay
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Month-wise Plant/Caps bill status (owner request 2026-09-22) — "how much is
 * left over from previous months vs. this month's bill", for the two
 * recurring supplier bills the office pays (see SupplierBillService's class
 * doc for the payment-waterfall formula). Pay reuses the existing generic
 * `ExpenseForm` (BOTTLE_REFILL_PAYMENT / CAPS_PURCHASED categories already
 * exist) pre-filled with the total pending amount, rather than building a new
 * payment-recording path.
 */
export function SupplierBillCards() {
  const canView = useCan('van_cash_ledger:view');
  const canPay = useCan('expenses:create');
  const canManageOpeningBalance = useCan('van_cash_ledger:manage');
  const { data, isLoading } = useSupplierBills();
  const queryClient = useQueryClient();

  const [payTarget, setPayTarget] = useState<{ category: 'BOTTLE_REFILL_PAYMENT' | 'CAPS_PURCHASED'; amount: number; label: string } | null>(null);
  const [openingBalanceOpen, setOpeningBalanceOpen] = useState(false);

  if (!canView) return null;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['van-cash-ledger', 'supplier-bills'] });

  if (isLoading || !data) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-40 rounded-[2rem]" />
        <Skeleton className="h-40 rounded-[2rem]" />
      </div>
    );
  }

  return (
    <>
      {canManageOpeningBalance && (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="ghost"
            className="rounded-xl font-bold gap-1.5 text-muted-foreground"
            onClick={() => setOpeningBalanceOpen(true)}
          >
            <History className="h-3.5 w-3.5" /> Opening Balance
          </Button>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <BillCard
          title="Plant Bill (Bottle Refill)"
          icon={Droplets}
          bucket={data.plant}
          canPay={canPay}
          onPay={() =>
            setPayTarget({ category: 'BOTTLE_REFILL_PAYMENT', amount: data.plant.totalPending, label: 'Plant bill payment' })
          }
        />
        <BillCard
          title="Caps Bill"
          icon={PackageOpen}
          bucket={data.caps}
          canPay={canPay}
          onPay={() => setPayTarget({ category: 'CAPS_PURCHASED', amount: data.caps.totalPending, label: 'Caps bill payment' })}
        />
      </div>

      {payTarget && (
        <ExpenseForm
          open={!!payTarget}
          onOpenChange={(o) => { if (!o) setPayTarget(null); }}
          expense={{ category: payTarget.category, amount: payTarget.amount, description: payTarget.label }}
          onAfterSuccess={invalidate}
        />
      )}

      {canManageOpeningBalance && (
        <SupplierBillOpeningBalanceDialog open={openingBalanceOpen} onOpenChange={setOpeningBalanceOpen} />
      )}
    </>
  );
}
