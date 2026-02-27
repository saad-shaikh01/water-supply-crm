'use client';

import { useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
} from '@water-supply-crm/ui';
import { cn } from '@water-supply-crm/ui';
import { Clock, Loader2, MessageCircle, Paperclip, Send } from 'lucide-react';
import { useCreateTicketMessage, useTicketMessages } from '../hooks/use-tickets';

const STATUS_COLOR: Record<string, string> = {
  OPEN: 'bg-amber-500/10 text-amber-600',
  IN_PROGRESS: 'bg-blue-500/10 text-blue-600',
  RESOLVED: 'bg-emerald-500/10 text-emerald-600',
  CLOSED: 'bg-muted text-muted-foreground',
};

const PRIORITY_COLOR: Record<string, string> = {
  LOW: 'bg-muted text-muted-foreground',
  NORMAL: 'bg-blue-500/10 text-blue-600',
  HIGH: 'bg-amber-500/10 text-amber-600',
  URGENT: 'bg-destructive/10 text-destructive',
};

const TYPE_COLOR: Record<string, string> = {
  COMPLAINT: 'bg-destructive/10 text-destructive',
  FEEDBACK: 'bg-emerald-500/10 text-emerald-600',
};

interface TicketDetailDialogProps {
  ticket: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type TimelineMessage = {
  id: string;
  senderRole: string;
  message: string;
  createdAt: string;
  attachments?: Array<Record<string, unknown>>;
  isOriginal?: boolean;
};

function getAttachmentLabel(attachment: Record<string, unknown>, index: number) {
  return (
    (typeof attachment.name === 'string' && attachment.name) ||
    (typeof attachment.label === 'string' && attachment.label) ||
    (typeof attachment.filename === 'string' && attachment.filename) ||
    `Attachment ${index + 1}`
  );
}

function getAttachmentUrl(attachment: Record<string, unknown>) {
  if (typeof attachment.url === 'string') return attachment.url;
  if (typeof attachment.href === 'string') return attachment.href;
  return null;
}

export function TicketDetailDialog({ ticket, open, onOpenChange }: TicketDetailDialogProps) {
  const [message, setMessage] = useState('');
  const [attachmentName, setAttachmentName] = useState('');
  const [attachmentUrl, setAttachmentUrl] = useState('');

  const {
    data: rawMessages,
    isLoading,
    isError,
    refetch,
  } = useTicketMessages(ticket?.id ?? '', open);
  const { mutate: sendMessage, isPending } = useCreateTicketMessage(ticket?.id ?? '');

  const timeline = useMemo<TimelineMessage[]>(() => {
    if (!ticket) return [];

    const items: TimelineMessage[] = [
      {
        id: `ticket-${ticket.id}`,
        senderRole: 'CUSTOMER',
        message: ticket.description,
        createdAt: ticket.createdAt,
        attachments: [],
        isOriginal: true,
      },
    ];

    if (Array.isArray(rawMessages)) {
      items.push(...(rawMessages as TimelineMessage[]));
    }

    if (items.length === 1 && ticket.vendorReply) {
      items.push({
        id: `legacy-reply-${ticket.id}`,
        senderRole: 'VENDOR',
        message: ticket.vendorReply,
        createdAt: ticket.resolvedAt ?? ticket.createdAt,
        attachments: [],
      });
    }

    return items;
  }, [rawMessages, ticket]);

  if (!ticket) return null;

  const clearComposer = () => {
    setMessage('');
    setAttachmentName('');
    setAttachmentUrl('');
  };

  const handleSubmit = () => {
    const trimmedMessage = message.trim();
    const trimmedAttachmentUrl = attachmentUrl.trim();

    if (!trimmedMessage) return;

    const attachments = trimmedAttachmentUrl
      ? [
          {
            name: attachmentName.trim() || 'Attachment',
            url: trimmedAttachmentUrl,
          },
        ]
      : undefined;

    sendMessage(
      { message: trimmedMessage, attachments },
      { onSuccess: clearComposer }
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (!nextOpen) clearComposer();
      }}
    >
      <DialogContent className="sm:max-w-2xl rounded-3xl border-border/50 bg-card/90 backdrop-blur-xl">
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
          <div className="rounded-2xl border border-border/50 bg-background/70 p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Conversation</p>
              <p className="text-[11px] text-muted-foreground">
                {timeline.length} message{timeline.length === 1 ? '' : 's'}
              </p>
            </div>

            {isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading conversation...
              </div>
            ) : isError ? (
              <button
                type="button"
                onClick={() => refetch()}
                className="text-sm font-bold text-primary"
              >
                Failed to load messages. Retry
              </button>
            ) : (
              <div className="max-h-[22rem] space-y-3 overflow-y-auto pr-1">
                {timeline.map((entry) => {
                  const isCustomer = entry.senderRole === 'CUSTOMER';
                  const attachments = Array.isArray(entry.attachments) ? entry.attachments : [];

                  return (
                    <div key={entry.id} className={cn('flex', isCustomer ? 'justify-end' : 'justify-start')}>
                      <div
                        className={cn(
                          'max-w-[90%] rounded-2xl border p-3',
                          isCustomer
                            ? 'border-primary/10 bg-primary/5'
                            : 'border-border/50 bg-muted/40'
                        )}
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                            {entry.isOriginal ? 'You (Original)' : isCustomer ? 'You' : 'Vendor'}
                          </span>
                          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {new Date(entry.createdAt).toLocaleDateString('en-PK', {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                            })}
                          </span>
                        </div>

                        <p className="mt-2 text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap">
                          {entry.message}
                        </p>

                        {attachments.length > 0 && (
                          <div className="mt-3 space-y-1.5">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                              Attachments
                            </p>
                            <div className="space-y-1">
                              {attachments.map((attachment, index) => {
                                const label = getAttachmentLabel(attachment, index);
                                const url = getAttachmentUrl(attachment);

                                return url ? (
                                  <a
                                    key={`${entry.id}-attachment-${index}`}
                                    href={url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="flex items-center gap-2 text-xs font-bold text-primary hover:underline"
                                  >
                                    <Paperclip className="h-3.5 w-3.5" />
                                    {label}
                                  </a>
                                ) : (
                                  <div
                                    key={`${entry.id}-attachment-${index}`}
                                    className="flex items-center gap-2 text-xs font-bold text-foreground/80"
                                  >
                                    <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
                                    {label}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-border/50 bg-background/70 p-4 space-y-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Reply</p>

            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              placeholder="Add a reply or follow-up..."
              className="w-full rounded-2xl border border-border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                value={attachmentName}
                onChange={(e) => setAttachmentName(e.target.value)}
                placeholder="Attachment label (optional)"
                className="rounded-2xl"
              />
              <Input
                value={attachmentUrl}
                onChange={(e) => setAttachmentUrl(e.target.value)}
                placeholder="Attachment URL (optional)"
                className="rounded-2xl"
              />
            </div>

            <div className="flex justify-end">
              <Button
                type="button"
                onClick={handleSubmit}
                disabled={!message.trim() || isPending}
                className="rounded-2xl font-bold gap-2 shadow-lg shadow-primary/20"
              >
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Send Reply
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
