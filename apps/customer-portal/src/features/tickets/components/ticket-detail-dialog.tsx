'use client';

import { useMemo, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@water-supply-crm/ui';
import { cn } from '@water-supply-crm/ui';
import {
  CheckCircle2,
  Clock,
  Loader2,
  MessageCircle,
  Paperclip,
  Send,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useCreateTicketMessage, useTicketMessages } from '../hooks/use-tickets';
import { ticketsApi } from '../api/tickets.api';

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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState('');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploadedAttachment, setUploadedAttachment] = useState<{
    key: string;
    url: string;
    name: string;
  } | null>(null);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);

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
    setPendingFile(null);
    setUploadedAttachment(null);
    setIsUploadingAttachment(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setPendingFile(file);
    setUploadedAttachment(null);
    setIsUploadingAttachment(true);

    try {
      const formData = new FormData();
      formData.append('attachment', file);
      const { data } = await ticketsApi.uploadAttachment(formData);
      setUploadedAttachment(data);
    } catch {
      toast.error('Failed to upload attachment. Please try again.');
      setPendingFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } finally {
      setIsUploadingAttachment(false);
    }
  };

  const removeAttachment = () => {
    setPendingFile(null);
    setUploadedAttachment(null);
    setIsUploadingAttachment(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSubmit = () => {
    if (!message.trim()) return;

    const attachments = uploadedAttachment
      ? [{ name: uploadedAttachment.name, url: uploadedAttachment.url, key: uploadedAttachment.key }]
      : undefined;

    sendMessage(
      { message: message.trim(), attachments },
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

            {/* Attachment picker */}
            <div className="space-y-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.pdf,.doc,.docx,.txt"
                className="hidden"
                onChange={handleFileChange}
              />

              {!pendingFile ? (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-2 text-xs font-bold text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Paperclip className="h-3.5 w-3.5" />
                  Attach a file (optional)
                </button>
              ) : (
                <div className="flex items-center gap-2 rounded-xl border border-border/50 bg-muted/30 px-3 py-2">
                  {isUploadingAttachment ? (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                  ) : uploadedAttachment ? (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                  ) : (
                    <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="flex-1 truncate text-xs font-bold">
                    {pendingFile.name}
                  </span>
                  {isUploadingAttachment && (
                    <span className="text-[10px] text-muted-foreground">Uploading…</span>
                  )}
                  <button
                    type="button"
                    onClick={removeAttachment}
                    className="shrink-0 text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>

            <div className="flex justify-end">
              <Button
                type="button"
                onClick={handleSubmit}
                disabled={!message.trim() || isPending || isUploadingAttachment}
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
