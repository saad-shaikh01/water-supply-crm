'use client';

import { useState } from 'react';
import { Inbox } from 'lucide-react';
import {
  Card, CardContent, Button, Sheet, SheetContent, SheetHeader, SheetTitle, Skeleton,
} from '@water-supply-crm/ui';
import { useCan } from '../../authz/hooks/use-can';
import { useAuthStore } from '../../../store/auth.store';
import { usePendingHandovers, usePendingRemittances } from '../hooks/use-van-cash-ledger';
import { VAN_CASH_LEDGER_PERMISSIONS } from '../constants';
import { ApproveHandoverDialog, type HandoverApprovalTarget } from './approve-handover-dialog';
import { ApproveRemittanceDialog, type RemittanceApprovalTarget } from './approve-remittance-dialog';
import { VoidRemittanceDialog, type RemittanceVoidTarget } from './void-remittance-dialog';
import { CorrectRemittanceDialog, type RemittanceCorrectTarget } from './correct-remittance-dialog';
import type { PendingHandover, PendingRemittance, RemittanceDestination } from '../api/van-cash-ledger.api';

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' });

const DESTINATION_LABELS: Record<RemittanceDestination, string> = {
  OWNER: 'Owner',
  CEO: 'CEO',
  BANK: 'Bank',
  OTHER: 'Other',
};

function destinationLabel(r: Pick<PendingRemittance, 'destination' | 'destinationName'>): string {
  const base = DESTINATION_LABELS[r.destination];
  return r.destinationName ? `${base} (${r.destinationName})` : base;
}

interface PendingApprovalsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Opened from the stats bar's pending chips — a queue of every PENDING cash
 * handover (driver → office) AND every PENDING owner handover (office → owner/
 * bank) across the fleet, each row reusing the matching Approve dialog.
 */
export function PendingApprovalsPanel({ open, onOpenChange }: PendingApprovalsPanelProps) {
  const { data: handovers = [], isLoading: handoversLoading } = usePendingHandovers();
  const { data: remittances = [], isLoading: remittancesLoading } = usePendingRemittances();
  const canApprove = useCan(VAN_CASH_LEDGER_PERMISSIONS.approve);
  const canApproveRemit = useCan(VAN_CASH_LEDGER_PERMISSIONS.remitApprove);
  const currentUserId = useAuthStore((s) => s.user?.id);

  const [handoverTarget, setHandoverTarget] = useState<HandoverApprovalTarget | null>(null);
  const [remittanceTarget, setRemittanceTarget] = useState<RemittanceApprovalTarget | null>(null);
  const [voidTarget, setVoidTarget] = useState<RemittanceVoidTarget | null>(null);
  const [correctTarget, setCorrectTarget] = useState<RemittanceCorrectTarget | null>(null);

  // A submitter may retract/fix their OWN still-pending remittance; approvers
  // may act on any (backend enforces the same rule).
  const canManageRemittance = (r: PendingRemittance) =>
    canApproveRemit || (!!currentUserId && r.submittedBy?.id === currentUserId);

  const toManageTarget = (r: PendingRemittance): RemittanceVoidTarget & RemittanceCorrectTarget => ({
    sourceRecordId: r.id,
    amount: r.amount,
    destinationLabel: destinationLabel(r),
    version: r.version,
  });

  const toHandoverTarget = (h: PendingHandover): HandoverApprovalTarget => ({
    sourceRecordId: h.id,
    dailySheetId: h.dailySheetId,
    vanPlateNumber: h.vanPlateNumber,
    driverName: h.driverName,
    date: h.date,
    amount: h.amount,
    version: h.version,
  });

  const toRemittanceTarget = (r: PendingRemittance): RemittanceApprovalTarget => ({
    sourceRecordId: r.id,
    date: r.date,
    amount: r.amount,
    destinationLabel: destinationLabel(r),
    submittedByName: r.submittedBy?.name ?? null,
    version: r.version,
  });

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-md flex flex-col">
          <SheetHeader>
            <SheetTitle className="text-xl font-black">Pending Approvals</SheetTitle>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto space-y-5 py-2">
            {/* Driver → office handovers */}
            <section className="space-y-2">
              <h4 className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">
                Cash Handovers (driver → office)
              </h4>
              {handoversLoading ? (
                Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)
              ) : handovers.length === 0 ? (
                <EmptyRow label="No pending cash handovers" />
              ) : (
                handovers.map((h) => (
                  <Card key={h.id} className="bg-card/50 border-border/40 rounded-2xl">
                    <CardContent className="p-3 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold truncate">{h.driverName}</p>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {h.vanPlateNumber} · {fmtDate(h.date)}
                        </p>
                      </div>
                      <div className="text-right shrink-0 space-y-1">
                        <p className="font-mono font-black text-sm text-emerald-500">
                          ₨ {h.amount.toLocaleString()}
                        </p>
                        {canApprove && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 rounded-full text-[10px] px-2.5 font-bold"
                            onClick={() => setHandoverTarget(toHandoverTarget(h))}
                          >
                            Approve
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </section>

            {/* Office → owner handovers */}
            <section className="space-y-2">
              <h4 className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">
                Owner Handovers (office → owner / bank)
              </h4>
              {remittancesLoading ? (
                Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)
              ) : remittances.length === 0 ? (
                <EmptyRow label="No pending owner handovers" />
              ) : (
                remittances.map((r) => (
                  <Card key={r.id} className="bg-card/50 border-border/40 rounded-2xl">
                    <CardContent className="p-3 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold truncate">
                          {destinationLabel(r)}
                          {r.correctsEntryId && (
                            <span className="ml-1 text-[10px] font-bold text-amber-500">correction</span>
                          )}
                        </p>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {r.submittedBy?.name ?? '—'} · {fmtDate(r.date)}
                          {r.reference ? ` · Ref ${r.reference}` : ''}
                        </p>
                      </div>
                      <div className="text-right shrink-0 space-y-1">
                        <p className="font-mono font-black text-sm text-violet-500">
                          ₨ {r.amount.toLocaleString()}
                        </p>
                        {canApproveRemit && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 rounded-full text-[10px] px-2.5 font-bold"
                            onClick={() => setRemittanceTarget(toRemittanceTarget(r))}
                          >
                            Approve
                          </Button>
                        )}
                        {canManageRemittance(r) && (
                          <div className="flex justify-end gap-1">
                            {!r.correctsEntryId && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 rounded-full text-[10px] px-2.5 font-bold"
                                onClick={() => setCorrectTarget(toManageTarget(r))}
                              >
                                Correct
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 rounded-full text-[10px] px-2.5 font-bold text-destructive"
                              onClick={() => setVoidTarget(toManageTarget(r))}
                            >
                              Void
                            </Button>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </section>
          </div>
        </SheetContent>
      </Sheet>

      <ApproveHandoverDialog
        target={handoverTarget}
        open={!!handoverTarget}
        onOpenChange={(o) => { if (!o) setHandoverTarget(null); }}
      />
      <ApproveRemittanceDialog
        target={remittanceTarget}
        open={!!remittanceTarget}
        onOpenChange={(o) => { if (!o) setRemittanceTarget(null); }}
      />
      <CorrectRemittanceDialog
        target={correctTarget}
        open={!!correctTarget}
        onOpenChange={(o) => { if (!o) setCorrectTarget(null); }}
      />
      <VoidRemittanceDialog
        target={voidTarget}
        open={!!voidTarget}
        onOpenChange={(o) => { if (!o) setVoidTarget(null); }}
      />
    </>
  );
}

function EmptyRow({ label }: { label: string }) {
  return (
    <Card className="bg-card/30 border-border/40 rounded-2xl">
      <CardContent className="p-6 flex flex-col items-center justify-center gap-2">
        <Inbox className="h-6 w-6 text-muted-foreground/40" />
        <p className="text-xs font-bold text-muted-foreground/40">{label}</p>
      </CardContent>
    </Card>
  );
}
