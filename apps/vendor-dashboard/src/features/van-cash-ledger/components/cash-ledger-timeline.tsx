'use client';

import { useState } from 'react';
import { Inbox } from 'lucide-react';
import {
  Badge, Button, Card, CardContent, DataTablePagination, Skeleton, cn,
} from '@water-supply-crm/ui';
import { useCan } from '../../authz/hooks/use-can';
import { useCashLedgerTimeline } from '../hooks/use-van-cash-ledger';
import { cashLedgerRowMeta, VAN_CASH_LEDGER_PERMISSIONS } from '../constants';
import { ApproveHandoverDialog, type HandoverApprovalTarget } from './approve-handover-dialog';
import { VoidRemittanceDialog, type RemittanceVoidTarget } from './void-remittance-dialog';
import { CorrectRemittanceDialog, type RemittanceCorrectTarget } from './correct-remittance-dialog';
import type { CashLedgerRow } from '../api/van-cash-ledger.api';

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' });

const money = (n: number) => `₨ ${Math.abs(Number(n)).toLocaleString()}`;

interface TimelineRowProps {
  row: CashLedgerRow;
  canApprove: boolean;
  canRemitApprove: boolean;
  canRemitVoid: boolean;
  onApprove: () => void;
  onVoidRemittance: () => void;
  onCorrectRemittance: () => void;
}

function TimelineRow({
  row, canApprove, canRemitApprove, canRemitVoid,
  onApprove, onVoidRemittance, onCorrectRemittance,
}: TimelineRowProps) {
  const meta = cashLedgerRowMeta(row.type);
  const isPending = row.status === 'PENDING';
  const isCashInLike = row.type === 'CASH_IN' || row.type === 'CASH_IN_CORRECTION';
  const isRemittance = row.type === 'CASH_REMITTANCE_OUT';
  const canApproveThisRow = isCashInLike && isPending && canApprove && !!row.sourceRecordId;
  // A voided remittance is a terminal audit row — no further actions.
  const canActOnRemittance = isRemittance && !row.isVoided && !!row.sourceRecordId;

  const metadata = [
    row.submittedByName ? `by ${row.submittedByName}` : null,
    row.approvedByName ? `approved by ${row.approvedByName}` : null,
    row.isVoided && row.voidReason ? `voided — ${row.voidReason}` : null,
  ].filter(Boolean) as string[];

  return (
    <Card className="bg-card/50 border-border/40 rounded-2xl">
      <CardContent className="p-3 flex items-center gap-3">
        <span className={cn('h-2.5 w-2.5 rounded-full shrink-0', meta.solid)} aria-hidden />

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full border-none', meta.color)}>
              {meta.label}
            </Badge>
            <Badge variant="secondary" className="text-[10px] font-medium">{row.sourceBadge}</Badge>
            {row.vanPlateNumber && (
              <Badge variant="secondary" className="text-[10px] font-mono">{row.vanPlateNumber}</Badge>
            )}
            {isCashInLike && isPending && (
              <Badge className="text-[10px] font-bold px-2 py-0.5 rounded-full border-none bg-amber-500/10 text-amber-500">
                PENDING
              </Badge>
            )}
            {isRemittance && row.isVoided && (
              <Badge className="text-[10px] font-bold px-2 py-0.5 rounded-full border-none bg-destructive/10 text-destructive">
                VOIDED
              </Badge>
            )}
          </div>
          <p className={cn('text-xs font-semibold truncate mt-1', row.isVoided && 'line-through text-muted-foreground')}>
            {row.title}
          </p>
          {metadata.length > 0 && (
            <p className="text-[10px] text-muted-foreground truncate mt-0.5">{metadata.join(' · ')}</p>
          )}
        </div>

        <div className="text-right shrink-0 space-y-1">
          <p className={cn('font-mono font-black text-sm', meta.amountClass, row.isVoided && 'line-through opacity-60')}>
            {row.amount < 0 ? '-' : '+'} {money(row.amount)}
          </p>
          <p className="text-[10px] text-muted-foreground tabular-nums">
            Bal: <span className="font-bold text-foreground">₨ {Number(row.runningBalance).toLocaleString()}</span>
          </p>
          <p className="text-[10px] text-muted-foreground">{fmtDate(row.date)}</p>
          {canApproveThisRow && (
            <Button size="sm" variant="outline" className="h-6 rounded-full text-[10px] px-2.5 font-bold" onClick={onApprove}>
              Approve
            </Button>
          )}
          {canActOnRemittance && (canRemitApprove || canRemitVoid) && (
            <div className="flex justify-end gap-1">
              {/* Correct only on the ROOT of a logical remittance — a per-row
                  amount on a correction (delta) row would be mistaken for the
                  chain total. Void stays available on delta rows (LIFO unwind). */}
              {canRemitApprove && !row.isCorrection && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 rounded-full text-[10px] px-2.5 font-bold"
                  onClick={onCorrectRemittance}
                >
                  Correct
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                className="h-6 rounded-full text-[10px] px-2.5 font-bold text-destructive"
                onClick={onVoidRemittance}
              >
                Void
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function CashLedgerTimeline() {
  const { data, isLoading, page, setPage, limit, setLimit } = useCashLedgerTimeline();
  const canApprove = useCan(VAN_CASH_LEDGER_PERMISSIONS.approve);
  const canRemitApprove = useCan(VAN_CASH_LEDGER_PERMISSIONS.remitApprove);
  const canRemitVoid = useCan(VAN_CASH_LEDGER_PERMISSIONS.remitVoid);
  const [approveTarget, setApproveTarget] = useState<HandoverApprovalTarget | null>(null);
  const [voidTarget, setVoidTarget] = useState<RemittanceVoidTarget | null>(null);
  const [correctTarget, setCorrectTarget] = useState<RemittanceCorrectTarget | null>(null);

  // The API returns the timeline newest-to-oldest (most recent movement first),
  // while each row's `runningBalance` is still the cumulative total up to and
  // including that row (the server folds it chronologically before reversing) —
  // rendered as-is, not re-sorted client-side.
  const rows = data?.data ?? [];
  const total = data?.meta?.total ?? 0;

  const remittanceTarget = (row: CashLedgerRow) => ({
    sourceRecordId: row.sourceRecordId as string,
    amount: row.displayAmount ?? Math.abs(row.amount),
    destinationLabel: row.sourceBadge,
    version: row.version ?? 1,
  });

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-black uppercase tracking-widest text-muted-foreground">Cash Ledger Timeline</h3>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-2xl" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card className="bg-card/30 border-border/40 rounded-2xl">
          <CardContent className="p-10 flex flex-col items-center justify-center gap-3">
            <div className="p-5 rounded-2xl bg-white/[0.01] border border-border">
              <Inbox className="h-8 w-8 text-muted-foreground/40" />
            </div>
            <p className="text-sm font-bold text-muted-foreground/40">No cash movements recorded for this period</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <TimelineRow
              key={`${row.type}:${row.id}`}
              row={row}
              canApprove={canApprove}
              canRemitApprove={canRemitApprove}
              canRemitVoid={canRemitVoid}
              onApprove={() => {
                if (!row.sourceRecordId) return;
                setApproveTarget({
                  sourceRecordId: row.sourceRecordId,
                  dailySheetId: row.dailySheetId,
                  vanPlateNumber: row.vanPlateNumber,
                  driverName: row.submittedByName,
                  date: row.date,
                  amount: row.amount,
                  // Always real now (Timeline CASH_IN/CASH_IN_CORRECTION rows carry
                  // their handover's actual version) — the `?? 1` only guards the
                  // types for OPENING_BALANCE/CASH_OUT rows, which never reach here
                  // since canApprove/onApprove only wire up for CASH_IN family rows.
                  version: row.version ?? 1,
                });
              }}
              onVoidRemittance={() => {
                if (!row.sourceRecordId) return;
                setVoidTarget(remittanceTarget(row));
              }}
              onCorrectRemittance={() => {
                if (!row.sourceRecordId) return;
                setCorrectTarget(remittanceTarget(row));
              }}
            />
          ))}
        </div>
      )}

      {/* Not wrapped in the "sticky bottom" treatment Expense Center's own
          timeline pagination uses — that slot is already owned by the Cash
          Ledger's stats bar (see cash-ledger-stats-bar.tsx), and stacking two
          sticky-bottom elements would overlap. */}
      {total > 0 && (
        <div className="bg-card/30 border border-border/40 rounded-2xl p-1">
          <DataTablePagination
            page={page}
            limit={limit}
            total={total}
            onPageChange={(p) => void setPage(p)}
            onLimitChange={(l) => { void setLimit(l); void setPage(1); }}
          />
        </div>
      )}

      <ApproveHandoverDialog
        target={approveTarget}
        open={!!approveTarget}
        onOpenChange={(o) => { if (!o) setApproveTarget(null); }}
      />
      <VoidRemittanceDialog
        target={voidTarget}
        open={!!voidTarget}
        onOpenChange={(o) => { if (!o) setVoidTarget(null); }}
      />
      <CorrectRemittanceDialog
        target={correctTarget}
        open={!!correctTarget}
        onOpenChange={(o) => { if (!o) setCorrectTarget(null); }}
      />
    </div>
  );
}
