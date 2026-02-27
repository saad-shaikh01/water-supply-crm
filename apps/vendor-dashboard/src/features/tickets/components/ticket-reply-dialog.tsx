'use client';

import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Label, Badge,
} from '@water-supply-crm/ui';
import { Loader2 } from 'lucide-react';
import { cn } from '@water-supply-crm/ui';

const STATUS_OPTIONS = [
  { value: 'IN_PROGRESS', label: 'In Progress' },
  { value: 'RESOLVED',    label: 'Resolved' },
  { value: 'CLOSED',      label: 'Closed' },
];

const TYPE_COLOR: Record<string, string> = {
  COMPLAINT: 'bg-destructive/10 text-destructive',
  FEEDBACK:  'bg-emerald-500/10 text-emerald-600',
};

const PRIORITY_COLOR: Record<string, string> = {
  LOW:    'bg-muted text-muted-foreground',
  NORMAL: 'bg-blue-500/10 text-blue-600',
  HIGH:   'bg-amber-500/10 text-amber-600',
  URGENT: 'bg-destructive/10 text-destructive',
};

interface TicketReplyDialogProps {
  ticket: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (data: { vendorReply: string; status: string }) => void;
  isPending?: boolean;
}

export function TicketReplyDialog({ ticket, open, onOpenChange, onConfirm, isPending }: TicketReplyDialogProps) {
  const [reply, setReply] = useState('');
  const [status, setStatus] = useState('IN_PROGRESS');

  useEffect(() => {
    if (!ticket || !open) return;

    if (ticket.status === 'OPEN') {
      setStatus('IN_PROGRESS');
      return;
    }

    if (STATUS_OPTIONS.some((opt) => opt.value === ticket.status)) {
      setStatus(ticket.status);
      return;
    }

    setStatus('IN_PROGRESS');
  }, [ticket, open]);

  const isValid = reply.trim().length >= 5;

  const handleConfirm = () => {
    if (!isValid) return;
    onConfirm({ vendorReply: reply.trim(), status });
  };

  const handleClose = (v: boolean) => {
    onOpenChange(v);
    if (!v) { setReply(''); setStatus('IN_PROGRESS'); }
  };

  if (!ticket) return null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-black">Reply to Ticket</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Ticket metadata */}
          <div className="rounded-2xl bg-accent/30 p-4 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-sm">{ticket.customer?.name}</span>
              <Badge className={cn('text-[10px] px-2 py-0 rounded-full border-none font-bold', TYPE_COLOR[ticket.type] ?? '')}>
                {ticket.type}
              </Badge>
              <Badge className={cn('text-[10px] px-2 py-0 rounded-full border-none font-bold', PRIORITY_COLOR[ticket.priority] ?? '')}>
                {ticket.priority}
              </Badge>
            </div>
            <p className="font-bold text-sm">{ticket.subject}</p>
            <p className="text-sm text-muted-foreground leading-relaxed">{ticket.description}</p>
          </div>

          {/* Status */}
          <div className="space-y-1.5">
            <Label className="text-xs font-bold uppercase tracking-wider">Update Status</Label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Reply */}
          <div className="space-y-1.5">
            <Label className="text-xs font-bold uppercase tracking-wider">Your Reply</Label>
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="Write your response to the customer..."
              rows={4}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            {reply.length > 0 && reply.length < 5 && (
              <p className="text-[11px] text-destructive">At least 5 characters required</p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)}>Cancel</Button>
          <Button disabled={!isValid || isPending} onClick={handleConfirm}>
            {isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Submit Reply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
