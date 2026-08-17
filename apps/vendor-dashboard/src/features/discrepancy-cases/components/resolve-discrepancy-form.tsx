'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Textarea,
} from '@water-supply-crm/ui';
import { cn } from '@water-supply-crm/ui';
import { toast } from 'sonner';
import { useResolveDiscrepancyCase } from '../hooks/use-discrepancy-cases';
import type { DiscrepancyResolutionType, DiscrepancyType } from '../api/discrepancy-cases.api';
import { useCan } from '../../authz/hooks/use-can';

const RESOLUTION_OPTIONS: { value: DiscrepancyResolutionType; label: string; description: string }[] = [
  { value: 'CHARGED_TO_DRIVER', label: 'Charge to Driver', description: "Deducted from the driver's next payroll (PENALTY)." },
  { value: 'COMPANY_LOSS', label: 'Company Loss', description: 'Written off as a vendor cost — no one is charged.' },
  { value: 'WAIVED', label: 'Waived', description: 'No money moves. A reason is required.' },
];

interface ResolveDiscrepancyFormProps {
  caseId: string;
  version: number;
  type: DiscrepancyType;
  reportedAmount?: number | null;
  onSuccess: () => void;
}

export function ResolveDiscrepancyForm({ caseId, version, type, reportedAmount, onSuccess }: ResolveDiscrepancyFormProps) {
  const canResolve = useCan('sheet_discrepancies:resolve');
  const [open, setOpen] = useState(false);
  const [resolutionType, setResolutionType] = useState<DiscrepancyResolutionType>('CHARGED_TO_DRIVER');
  // Pre-filled for CASH (exact rupee gap already known), blank for
  // BOTTLE/EMPTY (no rupee figure exists until the reviewer prices it).
  const [amount, setAmount] = useState(type === 'CASH' && reportedAmount ? String(Math.abs(reportedAmount)) : '');
  const [note, setNote] = useState('');

  const { mutate: resolveCase, isPending } = useResolveDiscrepancyCase();

  if (!canResolve) return null;

  const requiresAmount = resolutionType !== 'WAIVED';
  const requiresNote = resolutionType === 'WAIVED';
  const parsedAmount = parseFloat(amount);
  const canSubmit = requiresAmount ? !!amount && parsedAmount > 0 : !requiresNote || note.trim().length > 0;

  const reset = () => {
    setResolutionType('CHARGED_TO_DRIVER');
    setAmount(type === 'CASH' && reportedAmount ? String(Math.abs(reportedAmount)) : '');
    setNote('');
  };

  const handleOpenChange = (v: boolean) => {
    if (!v) reset();
    setOpen(v);
  };

  const handleSubmit = () => {
    if (requiresAmount && (!amount || parsedAmount <= 0)) {
      toast.error('Please enter a valid amount');
      return;
    }
    if (requiresNote && !note.trim()) {
      toast.error('A reason is required to waive a discrepancy case');
      return;
    }

    resolveCase(
      {
        id: caseId,
        dto: {
          resolutionType,
          resolutionAmount: requiresAmount ? parsedAmount : undefined,
          resolutionNote: note.trim() || undefined,
          version,
        },
      },
      {
        onSuccess: () => {
          toast.success('Discrepancy case resolved');
          setOpen(false);
          reset();
          onSuccess();
        },
      },
    );
  };

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} className="rounded-xl font-bold gap-2">
        Resolve
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md rounded-3xl">
          <DialogHeader>
            <DialogTitle className="font-black text-xl">Resolve Discrepancy</DialogTitle>
          </DialogHeader>

          <div className="space-y-5 py-2">
            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Resolution</Label>
              <div className="grid gap-2">
                {RESOLUTION_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setResolutionType(opt.value)}
                    className={cn(
                      'text-left rounded-xl border px-4 py-3 transition-colors',
                      resolutionType === opt.value
                        ? 'border-primary bg-primary/10'
                        : 'border-border/60 bg-background/50 hover:bg-accent/30',
                    )}
                  >
                    <p className="text-sm font-bold">{opt.label}</p>
                    <p className="text-xs text-muted-foreground">{opt.description}</p>
                  </button>
                ))}
              </div>
            </div>

            {requiresAmount && (
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  Amount (&#8360;)
                </Label>
                <Input
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="e.g. 500"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="h-11"
                />
              </div>
            )}

            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                Note {requiresNote ? '(required)' : '(optional)'}
              </Label>
              <Textarea
                placeholder={requiresNote ? 'Explain why this discrepancy is being waived...' : 'Add any notes about this decision...'}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                className="resize-none"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isPending || !canSubmit}
              className="rounded-xl font-bold"
            >
              {isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
