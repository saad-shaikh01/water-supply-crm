'use client';

import { useMemo, useState } from 'react';
import { AlertCircle, Ban, Calendar, HandCoins, Inbox, PlusCircle, Wallet } from 'lucide-react';
import { Badge, Button, cn } from '@water-supply-crm/ui';
import { DataTable } from '../../../components/shared/data-table';
import { StatusBadge } from '../../../components/shared/status-badge';
import { useCustomerDeposits, useDepositsConfig, useUpdateDepositsConfig } from '../hooks/use-customer-deposits';
import type { CustomerDeposit, CustomerDepositEntry } from '../api/customer-deposits.api';
import {
  DEPOSIT_DIRECTION_LABELS,
  depositDirectionSign,
  DEPOSIT_PAYMENT_METHOD_LABELS,
  depositTitle,
  fmtDepositAmount,
  fmtDepositDate,
} from '../format';
import { useDepositPermissions } from '../permissions';
import { CollectDepositDialog } from './collect-deposit-dialog';
import { SettleDepositDialog } from './settle-deposit-dialog';
import { WriteOffDepositDialog } from './write-off-deposit-dialog';
import { VoidDepositEntryDialog } from './void-deposit-entry-dialog';

interface CustomerDepositsTabProps {
  customerId: string;
}

interface FlatEntry {
  /** DataTable row identity — the entry's own id. */
  id: string;
  deposit: CustomerDeposit;
  entry: CustomerDepositEntry;
}

/**
 * "Deposits" tab on the customer detail page: refundable CASH/BOTTLE security
 * deposits, kept separate from what the customer owes for deliveries. One
 * summary card per held deposit (CASH + one per BOTTLE product), a "Collect"
 * action, and the full entry history across all of them. Entirely hidden by
 * `customer_deposits:view` at the page level (see customer-detail.tsx); this
 * component additionally checks the vendor's own depositsEnabled toggle,
 * since the feature is opt-in per vendor.
 */
export function CustomerDepositsTab({ customerId }: CustomerDepositsTabProps) {
  const { data: config } = useDepositsConfig();
  const { data: deposits, isLoading, isError, refetch, isFetching } = useCustomerDeposits(customerId, {
    enabled: config?.depositsEnabled ?? false,
  });
  const { canCollect, canRefund, canWriteOff, canVoid, canManageConfig } = useDepositPermissions();
  const updateConfig = useUpdateDepositsConfig();

  const [collectOpen, setCollectOpen] = useState(false);
  const [settleTarget, setSettleTarget] = useState<CustomerDeposit | null>(null);
  const [writeOffTarget, setWriteOffTarget] = useState<CustomerDeposit | null>(null);
  const [voidTarget, setVoidTarget] = useState<FlatEntry | null>(null);

  const rows = useMemo<FlatEntry[]>(() => {
    const flat = (deposits ?? []).flatMap((deposit) =>
      deposit.entries.map((entry) => ({ id: entry.id, deposit, entry })),
    );
    return flat.sort((a, b) => +new Date(b.entry.effectiveDate) - +new Date(a.entry.effectiveDate));
  }, [deposits]);

  if (config && !config.depositsEnabled) {
    return (
      <div className="py-12 flex flex-col items-center gap-3 text-center text-muted-foreground">
        <div className="p-5 rounded-2xl bg-white/[0.01] border border-border">
          <Wallet className="h-8 w-8 text-muted-foreground/40" />
        </div>
        <p className="font-semibold">Deposits are not enabled for this vendor.</p>
        <p className="text-xs max-w-sm">
          {canManageConfig
            ? 'Turn it on to start collecting refundable cash or bottle security deposits from customers.'
            : 'Ask a vendor admin to turn on Customer Deposits.'}
        </p>
        {canManageConfig && (
          <Button
            onClick={() => updateConfig.mutate(true)}
            disabled={updateConfig.isPending}
            className="rounded-xl font-bold gap-2"
          >
            {updateConfig.isPending ? 'Enabling…' : 'Enable Customer Deposits'}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold">Deposits</h3>
          <p className="text-xs text-muted-foreground">
            A refundable security deposit — kept separate from what the customer owes for deliveries.
          </p>
        </div>
        {canCollect && (
          <Button onClick={() => setCollectOpen(true)} className="rounded-xl font-bold gap-2 shrink-0">
            <PlusCircle className="h-4 w-4" /> Collect deposit
          </Button>
        )}
      </div>

      {(deposits ?? []).length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {deposits!.map((deposit) => (
            <div key={deposit.id} className="rounded-2xl border border-border bg-card/30 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="p-2 rounded-xl bg-primary/10 shrink-0">
                    <Wallet className="h-4 w-4 text-primary" />
                  </div>
                  <p className="text-sm font-bold truncate">{depositTitle(deposit)}</p>
                </div>
                <p className="text-sm font-black tabular-nums shrink-0">{fmtDepositAmount(deposit.type, deposit.balance)}</p>
              </div>
              {deposit.balance > 0 && (
                <div className="flex flex-wrap gap-2">
                  {canRefund && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 rounded-lg text-xs gap-1.5"
                      onClick={() => setSettleTarget(deposit)}
                    >
                      <HandCoins className="h-3.5 w-3.5" /> Settle
                    </Button>
                  )}
                  {canWriteOff && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 rounded-lg text-xs gap-1.5 text-muted-foreground"
                      onClick={() => setWriteOffTarget(deposit)}
                    >
                      <Ban className="h-3.5 w-3.5" /> Write off
                    </Button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {isError ? (
        <div role="alert" className="py-10 flex flex-col items-center gap-3 text-center text-muted-foreground">
          <AlertCircle className="h-8 w-8 text-destructive/70" />
          <p className="font-semibold">Couldn’t load deposits.</p>
          <Button variant="outline" size="sm" className="rounded-xl" onClick={() => refetch()} disabled={isFetching}>
            Try again
          </Button>
        </div>
      ) : !isLoading && rows.length === 0 ? (
        <div className="py-12 flex flex-col items-center gap-3 text-center text-muted-foreground">
          <div className="p-5 rounded-2xl bg-white/[0.01] border border-border">
            <Inbox className="h-8 w-8 text-muted-foreground/40" />
          </div>
          <p className="font-semibold">No deposits on this account yet.</p>
          <p className="text-xs max-w-sm">Cash or bottle security deposits collected from this customer will appear here.</p>
        </div>
      ) : (
        <DataTable
          data={rows}
          isLoading={isLoading}
          columns={[
            {
              key: 'date',
              header: 'Date',
              essential: true,
              cell: (r) => (
                <div className="flex items-center gap-2 whitespace-nowrap text-xs font-medium tabular-nums text-muted-foreground/80">
                  <Calendar className="h-3 w-3 shrink-0 text-muted-foreground/80" />
                  {fmtDepositDate(r.entry.effectiveDate)}
                </div>
              ),
            },
            {
              key: 'deposit',
              header: 'Deposit',
              essential: true,
              cell: (r) => <span className="text-xs font-bold whitespace-nowrap">{depositTitle(r.deposit)}</span>,
            },
            {
              key: 'direction',
              header: 'Action',
              essential: true,
              cell: (r) => (
                <span className={cn('text-xs font-semibold', r.entry.status === 'VOIDED' && 'line-through text-muted-foreground')}>
                  {DEPOSIT_DIRECTION_LABELS[r.entry.direction]}
                </span>
              ),
            },
            {
              key: 'amount',
              header: 'Amount',
              essential: true,
              cell: (r) => (
                <span
                  className={cn(
                    'font-mono font-bold text-xs whitespace-nowrap',
                    r.entry.direction === 'COLLECT' ? 'text-emerald-400' : 'text-rose-400',
                    r.entry.status === 'VOIDED' && 'line-through opacity-60',
                  )}
                >
                  {depositDirectionSign(r.entry.direction)} {fmtDepositAmount(r.deposit.type, r.entry.amount)}
                </span>
              ),
            },
            {
              key: 'source',
              header: 'Source',
              essential: true,
              cell: (r) => (
                <div className="flex flex-col items-start gap-1">
                  <Badge variant={r.entry.source === 'DELIVERY' ? 'info' : 'outline'} className="text-[10px]">
                    {r.entry.source === 'DELIVERY' ? 'Delivery' : 'Office'}
                  </Badge>
                  {/* Only a cash-amount deposit has a payment method; CASH is the normal case, so
                      only bank/online are called out (they never touched the office cash box). */}
                  {r.deposit.type === 'CASH' &&
                    (r.entry.direction === 'COLLECT' || r.entry.direction === 'REFUND') &&
                    r.entry.paymentMethod &&
                    r.entry.paymentMethod !== 'CASH' && (
                      <Badge variant="outline" className="text-[10px]">
                        {DEPOSIT_PAYMENT_METHOD_LABELS[r.entry.paymentMethod]}
                      </Badge>
                    )}
                </div>
              ),
            },
            {
              key: 'status',
              header: 'Status',
              essential: true,
              cell: (r) => (
                <div className="scale-90 origin-left">
                  <StatusBadge status={r.entry.status} />
                </div>
              ),
            },
            {
              key: 'by',
              header: 'Recorded by',
              essential: true,
              cell: (r) => <span className="text-xs text-muted-foreground">{r.entry.createdBy?.name ?? '—'}</span>,
            },
            ...(canVoid
              ? [
                  {
                    key: 'actions',
                    header: '',
                    essential: true,
                    cell: (r: FlatEntry) =>
                      // A delivery-collected entry mirrors the stop's own deposit figure — it is
                      // corrected from that stop, never voided here (the backend rejects it too).
                      r.entry.status === 'POSTED' && !r.entry.reversalOf && r.entry.source !== 'DELIVERY' ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 rounded-lg text-[11px] text-destructive gap-1"
                          onClick={(e) => {
                            e.stopPropagation();
                            setVoidTarget(r);
                          }}
                        >
                          <Ban className="h-3 w-3" /> Void
                        </Button>
                      ) : null,
                  },
                ]
              : []),
          ]}
        />
      )}

      {canCollect && <CollectDepositDialog customerId={customerId} open={collectOpen} onOpenChange={setCollectOpen} />}

      {settleTarget && (
        <SettleDepositDialog deposit={settleTarget} open={!!settleTarget} onOpenChange={(o) => !o && setSettleTarget(null)} />
      )}

      {writeOffTarget && (
        <WriteOffDepositDialog
          deposit={writeOffTarget}
          open={!!writeOffTarget}
          onOpenChange={(o) => !o && setWriteOffTarget(null)}
        />
      )}

      {voidTarget && (
        <VoidDepositEntryDialog
          deposit={voidTarget.deposit}
          entry={voidTarget.entry}
          open={!!voidTarget}
          onOpenChange={(o) => !o && setVoidTarget(null)}
          onVoided={() => setVoidTarget(null)}
        />
      )}
    </div>
  );
}
