'use client';

import { useState } from 'react';
import { Check, X, Eye, FileText, Calendar } from 'lucide-react';
import {
  Button,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Input, Label, Badge
} from '@water-supply-crm/ui';
import { toast } from 'sonner';
import { DataTable } from '../../../components/shared/data-table';
import { StatusBadge } from '../../../components/shared/status-badge';
import { usePaymentRequests, useApproveRequest, useRejectRequest } from '../hooks/use-transactions';
import { transactionsApi } from '../api/transactions.api';
import { cn } from '@water-supply-crm/ui';

async function openScreenshot(requestId: string) {
  // Open a blank tab immediately inside the user-gesture handler, then
  // navigate it once the signed URL arrives (avoids popup-blocker issues).
  const win = window.open('', '_blank');
  try {
    const { data } = await transactionsApi.getScreenshotUrl(requestId);
    win?.location.assign(data.signedUrl);
  } catch {
    win?.close();
    toast.error('Could not load screenshot');
  }
}

export function PaymentRequestList() {
  const { data, isLoading, page, setPage, limit, setLimit } = usePaymentRequests();
  const { mutate: approve, isPending: isApproving } = useApproveRequest();
  const { mutate: reject, isPending: isRejecting } = useRejectRequest();

  const [selectedRequest, setSelectedRequest] = useState<any>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const requests = (data as { data?: unknown[]; meta?: { total: number } } | undefined);
  const rows = (requests?.data ?? []) as Array<{
    id: string;
    amount: number;
    method: string;
    status: string;
    createdAt: string;
    referenceNo?: string;
    customer?: { name: string; customerCode: string };
    screenshotPath?: string;
  }>;
  const total = requests?.meta?.total ?? 0;

  const handleReject = () => {
    if (selectedRequest && rejectReason) {
      reject({ id: selectedRequest.id, reason: rejectReason }, {
        onSuccess: () => {
          setRejectOpen(false);
          setSelectedRequest(null);
          setRejectReason('');
        }
      });
    }
  };

  return (
    <div className="space-y-6">
      <DataTable
        data={rows}
        isLoading={isLoading}
        page={page}
        limit={limit}
        total={total}
        onPageChange={setPage}
        onLimitChange={setLimit}
        emptyMessage="No pending payment requests."
        columns={[
          {
            key: 'date',
            header: 'Date',
            cell: (r) => (
              <div className="flex items-center gap-2 text-muted-foreground/80 whitespace-nowrap">
                <Calendar className="h-3 w-3 shrink-0" />
                <span className="text-xs font-medium tabular-nums">
                  {new Date(r.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </span>
              </div>
            )
          },
          {
            key: 'customer',
            header: 'Customer',
            cell: (r) => (
              <div className="flex flex-col min-w-0 max-w-[180px]">
                <span className="font-bold text-sm text-white truncate">{r.customer?.name}</span>
                <span className="text-[10px] text-muted-foreground/60 font-mono truncate">{r.customer?.customerCode}</span>
              </div>
            )
          },
          {
            key: 'amount',
            header: 'Amount',
            cell: (r) => (
              <div className="font-mono font-bold text-xs text-emerald-400 whitespace-nowrap">
                ₨ {r.amount.toLocaleString()}
              </div>
            )
          },
          {
            key: 'method',
            header: 'Method',
            cell: (r) => (
              <Badge variant="outline" className="font-mono text-[9px] bg-white/5 border-white/10 text-white/60 px-1.5 py-0 rounded-md whitespace-nowrap">
                {r.method.replace('MANUAL_', '').replace('_', ' ')}
              </Badge>
            )
          },
          {
            key: 'status',
            header: 'Status',
            cell: (r) => (
              <div className="scale-90 origin-left">
                <StatusBadge status={r.status} />
              </div>
            )
          },
          {
            key: 'actions',
            header: '',
            width: '100px',
            cell: (r) => (
              <div className="flex items-center gap-1 shrink-0">
                {r.status === 'PENDING' && (
                  <>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-emerald-400 hover:bg-emerald-500/10 rounded-full"
                      onClick={() => approve(r.id)}
                      disabled={isApproving}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-rose-400 hover:bg-rose-500/10 rounded-full"
                      onClick={() => { setSelectedRequest(r); setRejectOpen(true); }}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
                {r.screenshotPath && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-indigo-400 hover:bg-indigo-500/10 rounded-full"
                    onClick={() => openScreenshot(r.id)}
                  >
                    <Eye className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            )
          }
        ]}
      />

      {/* Reject Dialog */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="rounded-3xl max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-xl font-black text-destructive flex items-center gap-2">
              <X className="h-6 w-6" /> Reject Payment
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              Please provide a reason for rejecting this payment of <span className="font-bold text-foreground">₨ {selectedRequest?.amount}</span> from <span className="font-bold text-foreground">{selectedRequest?.customer?.name}</span>.
            </p>
            <div className="space-y-2">
              <Label className="font-bold text-xs uppercase tracking-widest">Rejection Reason</Label>
              <Input
                placeholder="e.g. Screenshot blurry, Amount mismatch"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                className="h-11"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejectOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={isRejecting || !rejectReason}
              className="rounded-xl font-bold"
            >
              {isRejecting ? 'Rejecting...' : 'Confirm Rejection'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
