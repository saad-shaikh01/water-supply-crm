'use client';

import { useState } from 'react';
import { Inbox } from 'lucide-react';
import {
  Button, Card, CardContent, Sheet, SheetContent, SheetHeader, SheetTitle, Skeleton,
} from '@water-supply-crm/ui';
import { useCan } from '../../authz/hooks/use-can';
import { usePendingHandovers } from '../hooks/use-van-cash-ledger';
import { VAN_CASH_LEDGER_PERMISSIONS } from '../constants';
import { ApproveHandoverDialog, type HandoverApprovalTarget } from './approve-handover-dialog';
import type { PendingHandover } from '../api/van-cash-ledger.api';

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' });

interface PendingApprovalsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Opened from the stats bar's "N pending approvals" chip — a queue of every
 * PENDING cash handover across (or within, if `vanId` is filtered) the fleet,
 * each row reusing the same `ApproveHandoverDialog` the Timeline's own
 * inline Approve button opens.
 */
export function PendingApprovalsPanel({ open, onOpenChange }: PendingApprovalsPanelProps) {
  const { data, isLoading } = usePendingHandovers();
  const canApprove = useCan(VAN_CASH_LEDGER_PERMISSIONS.approve);
  const [approveTarget, setApproveTarget] = useState<HandoverApprovalTarget | null>(null);

  const handovers = data ?? [];

  const toTarget = (h: PendingHandover): HandoverApprovalTarget => ({
    sourceRecordId: h.id,
    dailySheetId: h.dailySheetId,
    vanPlateNumber: h.vanPlateNumber,
    driverName: h.driverName,
    date: h.date,
    amount: h.amount,
    version: h.version,
  });

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-md flex flex-col">
          <SheetHeader>
            <SheetTitle className="text-xl font-black">Pending Cash Handovers</SheetTitle>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto space-y-2 py-2">
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)
            ) : handovers.length === 0 ? (
              <Card className="bg-card/30 border-border/40 rounded-2xl">
                <CardContent className="p-8 flex flex-col items-center justify-center gap-3">
                  <Inbox className="h-7 w-7 text-muted-foreground/40" />
                  <p className="text-sm font-bold text-muted-foreground/40">No pending handovers</p>
                </CardContent>
              </Card>
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
                          onClick={() => setApproveTarget(toTarget(h))}
                        >
                          Approve
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>

      <ApproveHandoverDialog
        target={approveTarget}
        open={!!approveTarget}
        onOpenChange={(o) => { if (!o) setApproveTarget(null); }}
      />
    </>
  );
}
