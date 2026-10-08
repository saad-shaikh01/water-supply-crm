'use client';

import { Fragment } from 'react';
import { Loader2, FileText, Eye, AlertTriangle } from 'lucide-react';
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@water-supply-crm/ui';
import type { ReminderMessagePreview } from '../api/balance-reminders.api';

/** WhatsApp-style *bold* → <strong>; everything else is plain text. */
function renderWhatsAppText(text: string) {
  return text.split(/(\*[^*\n]+\*)/g).map((part, i) =>
    /^\*[^*\n]+\*$/.test(part) ? <strong key={i}>{part.slice(1, -1)}</strong> : <Fragment key={i}>{part}</Fragment>,
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
  customerName: string;
  isLoading: boolean;
  preview?: ReminderMessagePreview;
  onViewStatement: () => void;
  isLoadingStatement: boolean;
}

/** Read-only "exactly what this customer would receive" view. Sends nothing. */
export function MessagePreviewDialog({ open, onClose, customerName, isLoading, preview, onViewStatement, isLoadingStatement }: Props) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="rounded-3xl max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">Message preview — {customerName}</DialogTitle>
          <DialogDescription className="text-xs">
            Exactly what would be sent right now. Nothing is sent from this view.
          </DialogDescription>
        </DialogHeader>

        {isLoading || !preview ? (
          <div className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Building message…
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-2xl bg-emerald-950/60 border border-emerald-500/20 p-3 space-y-2">
              {preview.attachment && (
                <div className="flex items-center gap-2 rounded-xl bg-black/30 px-3 py-2">
                  <FileText className="h-4 w-4 text-rose-400 shrink-0" />
                  <span className="text-xs font-medium truncate flex-1">{preview.attachment.filename}</span>
                  <Button size="sm" variant="ghost" onClick={onViewStatement} disabled={isLoadingStatement} className="h-6 px-2 text-[10px] font-bold">
                    {isLoadingStatement ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Eye className="h-3 w-3 mr-1" /> View PDF</>}
                  </Button>
                </div>
              )}
              {preview.text ? (
                <p className="text-sm whitespace-pre-wrap leading-relaxed">{renderWhatsAppText(preview.text)}</p>
              ) : (
                <p className="text-xs italic text-muted-foreground">Message text unavailable — see parameters below.</p>
              )}
            </div>

            {preview.notes.length > 0 && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5 space-y-1">
                {preview.notes.map((n, i) => (
                  <p key={i} className="flex gap-1.5 text-[11px] text-amber-400">
                    <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" /> {n}
                  </p>
                ))}
              </div>
            )}

            <div className="text-[10px] text-muted-foreground space-y-0.5">
              <p>To: <span className="font-mono">{preview.phone || '—'}</span> · {preview.paymentType === 'MONTHLY' ? 'Monthly' : preview.paymentType === 'CASH' ? 'Cash' : ''}</p>
              <p>Template: <span className="font-mono">{preview.templateName}</span></p>
              <p className="break-all">Params: <span className="font-mono">{JSON.stringify(preview.params)}</span></p>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
