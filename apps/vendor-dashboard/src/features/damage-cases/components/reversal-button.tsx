'use client';

import { useState } from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@water-supply-crm/ui';
import { useReverseCase } from '../hooks/use-damage-cases';
import { useCan } from '../../authz/hooks/use-can';
import type { DamageCaseStatus } from '../api/damage-cases.api';

interface ReversalButtonProps {
  caseId: string;
  version: number;
  chargeAmount: number;
  status: DamageCaseStatus;
  onSuccess: () => void;
}

export function ReversalButton({ caseId, version, chargeAmount, status, onSuccess }: ReversalButtonProps) {
  const canReverse = useCan('damage_cases:reverse');
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { mutate: reverseCase, isPending } = useReverseCase();

  // Only render for CHARGED status + damage_cases:reverse
  if (status !== 'CHARGED') return null;
  if (!canReverse) return null;

  const handleConfirm = () => {
    reverseCase(
      { id: caseId, version },
      {
        onSuccess: () => {
          setConfirmOpen(false);
          toast.success('Charge reversed successfully');
          onSuccess();
        },
        onError: () => {
          toast.error('Failed to reverse charge');
        },
      },
    );
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setConfirmOpen(true)}
        className="rounded-xl font-bold gap-2 border-purple-500/30 text-purple-400 hover:bg-purple-500/10"
      >
        <RotateCcw className="h-4 w-4" />
        Reverse Charge
      </Button>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md rounded-3xl">
          <DialogHeader>
            <DialogTitle className="font-black text-xl flex items-center gap-2">
              <RotateCcw className="h-5 w-5 text-purple-400" />
              Reverse Charge
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground leading-relaxed">
              Reverse this charge of{' '}
              <span className="font-bold text-foreground dark:text-white">
                &#8360;{chargeAmount.toLocaleString()}
              </span>
              ? The customer&apos;s financial balance will be credited.
            </p>
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4">
              <p className="text-sm font-semibold text-amber-500">
                Note: the bottle wallet is NOT restored — physical bottles are gone.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={isPending}
              className="rounded-xl font-bold bg-purple-600 hover:bg-purple-700 text-white"
            >
              {isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Confirm Reversal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
