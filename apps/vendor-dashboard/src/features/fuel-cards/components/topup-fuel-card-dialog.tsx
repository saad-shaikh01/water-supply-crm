'use client';

import { useEffect, useRef, useState } from 'react';
import { Fuel, Paperclip, TriangleAlert, X } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Input, Label, Textarea,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@water-supply-crm/ui';
import { toast } from 'sonner';
import { useCashLedgerStats } from '../../van-cash-ledger/hooks/use-van-cash-ledger';
import { useCreateFuelCardTopUp, useFuelCards } from '../hooks/use-fuel-cards';
import { fuelCardApi, type FuelCard } from '../api/fuel-card.api';

interface TopUpFuelCardDialogProps {
  /**
   * Preset card (Fuel Cards page — clicking a specific card's "Top Up"
   * button). Omit/pass null to let the user pick any active card from a
   * dropdown instead (Cash Ledger / Expenses page entry points) — so
   * recording a top-up never requires navigating to /dashboard/fuel-cards
   * first.
   */
  card?: FuelCard | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

const money = (n: number) => `₨ ${Number(n ?? 0).toLocaleString()}`;

export function TopUpFuelCardDialog({ card: presetCard, open, onOpenChange }: TopUpFuelCardDialogProps) {
  const { data: stats } = useCashLedgerStats();
  const { data: allCards } = useFuelCards();
  const createTopUp = useCreateFuelCardTopUp();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedCardId, setSelectedCardId] = useState<string | undefined>(undefined);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayIso());
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [attachmentKey, setAttachmentKey] = useState<string | null>(null);
  const [attachmentName, setAttachmentName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const activeCards = (allCards ?? []).filter((c) => c.isActive);
  const card = presetCard ?? activeCards.find((c) => c.id === selectedCardId) ?? null;

  useEffect(() => {
    if (open) {
      setSelectedCardId(presetCard?.id);
      setAmount('');
      setDate(todayIso());
      setReference('');
      setNote('');
      setAttachmentKey(null);
      setAttachmentName(null);
      setUploading(false);
    }
    // presetCard is only meaningful at the moment the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const parsedAmount = Number(amount);
  const amountValid = amount !== '' && !Number.isNaN(parsedAmount) && parsedAmount > 0;
  const available = stats?.availableBalance ?? 0;
  const exceedsAvailable = amountValid && parsedAmount > available;
  const canSubmit =
    !!card && amountValid && !!date && !uploading && (!exceedsAvailable || note.trim().length > 0);

  const handleFile = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    try {
      const { key } = await fuelCardApi.uploadTopUpAttachment(file);
      setAttachmentKey(key);
      setAttachmentName(file.name);
    } catch {
      toast.error('Attachment upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = () => {
    if (!canSubmit || !card) return;
    createTopUp.mutate(
      {
        fuelCardId: card.id,
        data: {
          amount: parsedAmount,
          date,
          reference: reference.trim() || undefined,
          note: note.trim() || undefined,
          attachmentKey: attachmentKey ?? undefined,
        },
      },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-3xl max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <Fuel className="h-5 w-5 text-orange-500" />
            {presetCard ? `Top Up ${presetCard.name}` : 'Top Up Fuel Card'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {!presetCard && (
            <div className="space-y-2">
              <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
                Fuel Card <span className="text-destructive">*</span>
              </Label>
              {activeCards.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No active fuel cards yet — register one on the Fuel Cards page first.
                </p>
              ) : (
                <Select value={selectedCardId} onValueChange={setSelectedCardId}>
                  <SelectTrigger className="h-10 rounded-xl">
                    <SelectValue placeholder="Select a card" />
                  </SelectTrigger>
                  <SelectContent>
                    {activeCards.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} · ₨ {c.balance.toLocaleString()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}

          {card && (
            <div className="flex items-center justify-between rounded-2xl border border-border bg-muted/40 px-4 py-3">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Current Card Balance
                </p>
                <p className="text-xs text-muted-foreground truncate">{card.name}</p>
              </div>
              <p
                className={`text-lg font-black tabular-nums shrink-0 ${
                  card.balance < 0 ? 'text-destructive' : 'text-foreground'
                }`}
              >
                {money(card.balance)}
              </p>
            </div>
          )}

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
                autoFocus={!!presetCard}
              />
            </div>
            <div className="space-y-2">
              <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
                Date <span className="text-destructive">*</span>
              </Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-10 rounded-xl" />
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

          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">Reference</Label>
            <Input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className="h-10 rounded-xl"
              placeholder="Receipt #, txn id"
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
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">Receipt</Label>
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
          <Button onClick={handleSubmit} disabled={!canSubmit || createTopUp.isPending} className="rounded-xl font-bold">
            {createTopUp.isPending ? 'Recording…' : 'Record Top-up'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
