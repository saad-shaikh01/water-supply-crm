'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
  Button,
} from '@water-supply-crm/ui';
import { Trash2 } from 'lucide-react';
import { deletePaymentSchema, type DeletePaymentInput } from '../schemas';
import { useDeletePayment } from '../hooks/use-transactions';
import { ReasonSelect } from './reason-select';
import type { EditablePaymentRow } from './edit-payment-form';

interface DeletePaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transaction: EditablePaymentRow | null;
}

export function DeletePaymentDialog({ open, onOpenChange, transaction }: DeletePaymentDialogProps) {
  const { mutate: deletePayment, isPending } = useDeletePayment();

  const gross = transaction ? Math.abs(Number(transaction.amount)) : 0;

  const {
    handleSubmit, reset, watch, setValue,
    formState: { errors },
  } = useForm<DeletePaymentInput>({
    resolver: zodResolver(deletePaymentSchema),
    defaultValues: { reason: undefined, reasonNote: '' },
  });

  useEffect(() => {
    if (open) reset({ reason: undefined, reasonNote: '' });
  }, [open, transaction, reset]);

  const watchedReason = watch('reason');
  const watchedNote = watch('reasonNote') ?? '';

  const onSubmit = (values: DeletePaymentInput) => {
    if (!transaction) return;
    deletePayment(
      {
        id: transaction.id,
        data: {
          reason: values.reason,
          reasonNote: values.reason === 'OTHER' ? values.reasonNote : undefined,
          // Pass the token through verbatim — never reformat / re-derive.
          expectedUpdatedAt: transaction.updatedAt,
        },
      },
      { onSuccess: () => { reset(); onOpenChange(false); } },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-3xl max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-rose-500">
            <Trash2 className="h-5 w-5" />
            Remove Payment
          </DialogTitle>
          <DialogDescription>
            This entry will be removed from the ledger (a copy is kept in the audit log)
            and {transaction?.customer?.name ? `${transaction.customer.name}'s` : "the customer's"} balance
            will be restored by ₨{gross.toLocaleString()}.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          <ReasonSelect
            value={watchedReason}
            onChange={(v) => setValue('reason', v, { shouldValidate: true })}
            note={watchedNote}
            onNoteChange={(v) => setValue('reasonNote', v, { shouldValidate: true })}
            reasonError={errors.reason?.message}
            noteError={errors.reasonNote?.message}
            disabled={isPending}
          />

          <DialogFooter className="gap-3 sm:gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button
              type="submit"
              className="min-w-[140px] bg-rose-500 hover:bg-rose-600 text-white"
              disabled={isPending}
            >
              {isPending ? 'Removing...' : 'Remove Payment'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
