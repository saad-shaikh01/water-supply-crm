'use client';

import { useState } from 'react';
import { Check, X, Eye, FileText, Calendar } from 'lucide-react';
import {
  Button,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Input, Label, Badge
} from '@water-supply-crm/ui';
import { DataTable } from '../../../components/shared/data-table';
import { StatusBadge } from '../../../components/shared/status-badge';
import { usePaymentRequests, useApproveRequest, useRejectRequest } from '../hooks/use-transactions';
import { cn } from '@water-supply-crm/ui';

export function PaymentRequestList() {
  const { data, isLoading, page, setPage } = usePaymentRequests();
  const { mutate: approve, isPending: isApproving } = useApproveRequest();
  const { mutate: reject, isPending: isRejecting } = useRejectRequest();

  const [selectedRequest, setSelectedRequest] = useState<any>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const requests = (data as { data?: unknown[]; totalPages?: number } | undefined);
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
  const totalPages = requests?.totalPages ?? 1;

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
        totalPages={totalPages}
        onPageChange={setPage}
        emptyMessage="No pending payment requests."
        columns={[
          {
            key: 'date',
            header: 'Date',
            cell: (r) => (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Calendar className="h-3 w-3" />
                <span className="text-xs font-medium">
                  {new Date(r.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </span>
              </div>
            )
          },
          {
            key: 'customer',
            header: 'Customer',
            cell: (r) => (
              <div className="flex flex-col">
                <span className="font-bold text-sm">{r.customer?.name}</span>
                <span className="text-[10px] text-muted-foreground font-mono">{r.customer?.customerCode}</span>
              </div>
            )
          },
          {
            key: 'amount',
            header: 'Amount',
            cell: (r) => (
              <div className="font-mono font-black text-emerald-500">
                ₨ {r.amount.toLocaleString()}
              </div>
            )
          },
          {
            key: 'method',
            header: 'Method',
            cell: (r) => (
              <Badge variant="outline" className="font-mono text-[10px]">
                {r.method.replace('MANUAL_', '').replace('_', ' ')}
              </Badge>
            )
          },
          {
            key: 'status',
            header: 'Status',
            cell: (r) => <StatusBadge status={r.status} />
          },
          {
            key: 'actions',
            header: '',
            width: '120px',
            cell: (r) => (
              <div className="flex items-center gap-1">
                {r.status === 'PENDING' && (
                  <>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-emerald-500 hover:text-emerald-600 hover:bg-emerald-500/10 rounded-full"
                      onClick={() => approve(r.id)}
                      disabled={isApproving}
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10 rounded-full"
                      onClick={() => { setSelectedRequest(r); setRejectOpen(true); }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </>
                )}
                {r.screenshotPath && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-primary hover:bg-primary/10 rounded-full"
                    onClick={() => window.open(r.screenshotPath, '_blank')}
                  >
                    <Eye className="h-4 w-4" />
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
