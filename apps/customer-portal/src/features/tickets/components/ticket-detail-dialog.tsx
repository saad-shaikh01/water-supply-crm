'use client';

import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  Badge, Separator,
} from '@water-supply-crm/ui';
import { cn } from '@water-supply-crm/ui';
import { MessageCircle, Clock } from 'lucide-react';

const STATUS_COLOR: Record<string, string> = {
  OPEN:        'bg-amber-500/10 text-amber-600',
  IN_PROGRESS: 'bg-blue-500/10 text-blue-600',
  RESOLVED:    'bg-emerald-500/10 text-emerald-600',
  CLOSED:      'bg-muted text-muted-foreground',
};

const PRIORITY_COLOR: Record<string, string> = {
  LOW:    'bg-muted text-muted-foreground',
  NORMAL: 'bg-blue-500/10 text-blue-600',
  HIGH:   'bg-amber-500/10 text-amber-600',
  URGENT: 'bg-destructive/10 text-destructive',
};

const TYPE_COLOR: Record<string, string> = {
  COMPLAINT: 'bg-destructive/10 text-destructive',
  FEEDBACK:  'bg-emerald-500/10 text-emerald-600',
};

interface TicketDetailDialogProps {
  ticket: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TicketDetailDialog({ ticket, open, onOpenChange }: TicketDetailDialogProps) {
  if (!ticket) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg rounded-3xl border-border/50 bg-card/90 backdrop-blur-xl">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary shrink-0">
              <MessageCircle className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <DialogTitle className="font-black tracking-tight leading-tight">{ticket.subject}</DialogTitle>
              <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                <Badge className={cn('text-[10px] px-2 py-0 rounded-full border-none font-bold', TYPE_COLOR[ticket.type] ?? '')}>
                  {ticket.type}
                </Badge>
                <Badge className={cn('text-[10px] px-2 py-0 rounded-full border-none font-bold', PRIORITY_COLOR[ticket.priority] ?? '')}>
                  {ticket.priority}
                </Badge>
                <Badge className={cn('text-[10px] px-2 py-0 rounded-full border-none font-bold', STATUS_COLOR[ticket.status] ?? '')}>
                  {ticket.status.replace('_', ' ')}
                </Badge>
              </div>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Description */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">Your Message</p>
            <p className="text-sm leading-relaxed text-foreground/90">{ticket.description}</p>
          </div>

          <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
            <Clock className="h-3 w-3" />
            Submitted {new Date(ticket.createdAt).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' })}
          </p>

          <Separator className="opacity-50" />

          {/* Vendor reply */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">Vendor Response</p>
            {ticket.vendorReply ? (
              <div className="rounded-2xl bg-primary/5 border border-primary/10 p-4">
                <p className="text-sm leading-relaxed text-foreground/90">{ticket.vendorReply}</p>
                {ticket.resolvedAt && (
                  <p className="text-[11px] text-muted-foreground mt-2 flex items-center gap-1.5">
                    <Clock className="h-3 w-3" />
                    Replied {new Date(ticket.resolvedAt).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground italic">Awaiting vendor response...</p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
