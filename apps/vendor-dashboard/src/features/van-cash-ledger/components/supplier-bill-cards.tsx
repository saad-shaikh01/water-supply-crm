'use client';

import { useState } from 'react';
import { Card, CardContent, Button, Skeleton, cn } from '@water-supply-crm/ui';
import { Droplets, PackageOpen, Banknote } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useSupplierBills } from '../hooks/use-van-cash-ledger';
import { useCan } from '../../authz/hooks/use-can';
import { ExpenseForm } from '../../expenses/components/expense-form';
import type { SupplierBillBucket } from '../api/van-cash-ledger.api';

function fmt(n: number) {
  return `₨${n.toLocaleString('en', { maximumFractionDigits: 0 })}`;
}

interface BillCardProps {
  title: string;
  icon: typeof Droplets;
  bucket: SupplierBillBucket;
  canPay: boolean;
  onPay: () => void;
}

function BillCard({ title, icon: Icon, bucket, canPay, onPay }: BillCardProps) {
  const nothingOwed = bucket.totalPending <= 0;
  return (
    <Card className="bg-card/40 backdrop-blur-xl border-white/10 rounded-[2rem]">
      <CardContent className="pt-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-primary/10">
              <Icon className="h-5 w-5 text-primary" />
            </div>
            <p className="font-bold text-sm">{title}</p>
          </div>
          {canPay && (
            <Button
              size="sm"
              variant={nothingOwed ? 'outline' : 'default'}
              disabled={nothingOwed}
              onClick={onPay}
              className="rounded-xl font-bold gap-1.5"
            >
              <Banknote className="h-3.5 w-3.5" /> Pay
            </Button>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">Prev Months Pending</p>
            <p className={cn('text-base font-black font-mono mt-0.5', bucket.prevMonthPending > 0 ? 'text-rose-400' : 'text-emerald-400')}>
              {fmt(bucket.prevMonthPending)}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">This Month&apos;s Bill</p>
            <p className="text-base font-black font-mono mt-0.5">{fmt(bucket.currentMonthBill)}</p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">This Month Pending</p>
            <p className={cn('text-base font-black font-mono mt-0.5', bucket.currentMonthPending > 0 ? 'text-rose-400' : 'text-emerald-400')}>
              {fmt(bucket.currentMonthPending)}
            </p>
          </div>
        </div>
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
  const { data, isLoading } = useSupplierBills();
  const queryClient = useQueryClient();

  const [payTarget, setPayTarget] = useState<{ category: 'BOTTLE_REFILL_PAYMENT' | 'CAPS_PURCHASED'; amount: number; label: string } | null>(null);

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
    </>
  );
}
