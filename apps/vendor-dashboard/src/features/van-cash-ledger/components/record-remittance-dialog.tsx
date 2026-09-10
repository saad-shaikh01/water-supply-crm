'use client';

import { useEffect, useRef, useState } from 'react';
import { Landmark, Paperclip, TriangleAlert, X } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Input, Label, Textarea,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@water-supply-crm/ui';
import { toast } from 'sonner';
import { useCashLedgerStats, useCreateRemittance } from '../hooks/use-van-cash-ledger';
import { vanCashLedgerApi, type RemittanceDestination } from '../api/van-cash-ledger.api';

interface RecordRemittanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

const DESTINATIONS: { value: RemittanceDestination; label: string }[] = [
  { value: 'OWNER', label: 'Owner' },
  { value: 'CEO', label: 'CEO' },
  { value: 'BANK', label: 'Bank' },
  { value: 'OTHER', label: 'Other' },
];

const money = (n: number) => `₨ ${Number(n ?? 0).toLocaleString()}`;

export function RecordRemittanceDialog({ open, onOpenChange }: RecordRemittanceDialogProps) {
  const { data: stats } = useCashLedgerStats();
  const createRemittance = useCreateRemittance();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayIso());
  const [destination, setDestination] = useState<RemittanceDestination>('OWNER');
  const [destinationName, setDestinationName] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [attachmentKey, setAttachmentKey] = useState<string | null>(null);
  const [attachmentName, setAttachmentName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (open) {
      setAmount('');
      setDate(todayIso());
      setDestination('OWNER');
      setDestinationName('');
      setReference('');
      setNote('');
      setAttachmentKey(null);
      setAttachmentName(null);
      setUploading(false);
    }
  }, [open]);

  const parsedAmount = Number(amount);
  const amountValid = amount !== '' && !Number.isNaN(parsedAmount) && parsedAmount > 0;
  const available = stats?.availableBalance ?? 0;
  const exceedsAvailable = amountValid && parsedAmount > available;
  // Over-remittance is allowed (soft gate) but a note is then mandatory.
  const canSubmit =
    amountValid && !!date && !uploading && (!exceedsAvailable || note.trim().length > 0);

  const handleFile = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    try {
      const { key } = await vanCashLedgerApi.uploadRemittanceAttachment(file);
      setAttachmentKey(key);
      setAttachmentName(file.name);
    } catch {
      toast.error('Attachment upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = () => {
    if (!canSubmit) return;
    createRemittance.mutate(
      {
        amount: parsedAmount,
        date,
        destination,
        destinationName: destinationName.trim() || undefined,
        reference: reference.trim() || undefined,
        note: note.trim() || undefined,
        attachmentKey: attachmentKey ?? undefined,
      },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-3xl max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <Landmark className="h-5 w-5 text-violet-500" />
            Record Owner Handover
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
                Amount <span className="text-destructive">*</span>
              </Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="h-10 rounded-xl"
                placeholder="0.00"
              />
            </div>
            <div className="space-y-2">
              <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
                Date <span className="text-destructive">*</span>
              </Label>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="h-10 rounded-xl"
              />
            </div>
          </div>

          {stats && (
            <p className="text-[11px] text-muted-foreground">
              Office cash on hand: <span className="font-bold text-foreground">{money(available)}</span>
            </p>
          )}

          {exceedsAvailable && (
            <div className="flex gap-2 rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 text-amber-600 dark:text-amber-400">
              <TriangleAlert className="h-4 w-4 shrink-0 mt-0.5" />
              <p className="text-[11px] leading-relaxed">
                This exceeds recorded office cash by{' '}
                <span className="font-bold">{money(parsedAmount - available)}</span>. Proceed only if a
                handover or sale is still pending entry — a note is required.
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
                Destination <span className="text-destructive">*</span>
              </Label>
              <Select value={destination} onValueChange={(v) => setDestination(v as RemittanceDestination)}>
                <SelectTrigger className="h-10 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DESTINATIONS.map((d) => (
                    <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
                {destination === 'BANK' ? 'Bank / branch' : 'Name'}
              </Label>
              <Input
                value={destinationName}
                onChange={(e) => setDestinationName(e.target.value)}
                className="h-10 rounded-xl"
                placeholder={destination === 'BANK' ? 'e.g. HBL Main' : 'Optional'}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              Reference
            </Label>
            <Input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className="h-10 rounded-xl"
              placeholder="Deposit slip #, cheque #, txn id"
            />
          </div>

          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              Note {exceedsAvailable && <span className="text-destructive">*</span>}
            </Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={exceedsAvailable ? 'Explain the shortfall' : 'Optional'}
              className="rounded-xl min-h-16"
            />
          </div>

          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              Deposit slip / receipt
            </Label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".jpg,.jpeg,.png,.webp,.pdf"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
            {attachmentKey ? (
              <div className="flex items-center gap-2 rounded-xl bg-muted/50 px-3 py-2 text-xs">
                <Paperclip className="h-3.5 w-3.5 shrink-0" />
                <span className="flex-1 truncate">{attachmentName}</span>
                <button
                  type="button"
                  onClick={() => { setAttachmentKey(null); setAttachmentName(null); }}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="h-10 rounded-xl w-full text-xs"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? 'Uploading…' : 'Attach file'}
              </Button>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit || createRemittance.isPending}
            className="rounded-xl font-bold"
          >
            {createRemittance.isPending ? 'Recording…' : 'Record Handover'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
