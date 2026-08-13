'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@water-supply-crm/ui';
import { ShieldAlert } from 'lucide-react';
import { DamageReportForm } from '../../../driver/components/damage-report-form';

interface ReportDamageDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Thin dialog wrapper around the existing standalone DamageReportForm (used blank,
 * no dailySheetItemId/prefill props — the user picks customer/product themselves),
 * so it can be launched from the Daily Sheet's "+ Add / Record" menu without
 * duplicating any of its business logic. The form already toasts + resets its own
 * fields on a successful submit, so this dialog is closed manually by the user.
 */
export function ReportDamageDialog({ open, onClose }: ReportDamageDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-3xl max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-primary" />
            Report Damage / Incident
          </DialogTitle>
        </DialogHeader>
        <DamageReportForm />
      </DialogContent>
    </Dialog>
  );
}
