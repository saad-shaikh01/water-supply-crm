'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input, Label } from '@water-supply-crm/ui';
import { Copy, Eye, EyeOff, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { resetPasswordSchema, type ResetPasswordInput } from '../../schemas/reset-password';
import { apiErrorMessage } from '../../hooks/use-vendors';
import { useResetAdminPassword } from '../../hooks/use-vendor-detail';
import { generateStrongPassword } from '../../lib/generate-password';
import type { AdminChoice } from '../../types';

interface Props {
  vendorId: string;
  vendorName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Preselected admin (from a Users tab row). */
  admin?: AdminChoice | null;
}

const EMPTY: ResetPasswordInput = {
  adminUserId: '',
  newPassword: '',
  confirmPassword: '',
  superAdminPassword: '',
  reason: '',
  deliveryAck: false,
};

/**
 * Super-admin re-authenticated reset of a vendor admin's password. The passwords never reach a toast,
 * a log or the DOM as text, and every field is cleared when the dialog closes.
 */
export function ResetAdminPasswordDialog({ vendorId, vendorName, open, onOpenChange, admin }: Props) {
  const mutation = useResetAdminPassword(vendorId);
  const [admins, setAdmins] = useState<AdminChoice[]>([]);
  const [showPw, setShowPw] = useState(false);
  const [done, setDone] = useState<{ email: string } | null>(null);

  const form = useForm<ResetPasswordInput>({ resolver: zodResolver(resetPasswordSchema), mode: 'onChange', defaultValues: EMPTY });
  const { register, handleSubmit, formState, reset, setValue, watch } = form;
  const resetMutation = mutation.reset;

  useEffect(() => {
    if (open) reset({ ...EMPTY, adminUserId: admin?.id ?? '' });
    else {
      reset(EMPTY);
      setAdmins([]);
      setShowPw(false);
      setDone(null);
      resetMutation();
    }
  }, [open, admin, reset, resetMutation]);

  const needsPicker = !admin && admins.length > 0;
  const adminChosen = !needsPicker || !!watch('adminUserId');

  const onSubmit = (v: ResetPasswordInput) => {
    mutation.mutate(
      {
        newPassword: v.newPassword,
        superAdminPassword: v.superAdminPassword,
        ...(v.adminUserId ? { adminUserId: v.adminUserId } : {}),
        ...(v.reason?.trim() ? { reason: v.reason.trim() } : {}),
      },
      {
        onSuccess: (res) => {
          reset(EMPTY); // drop every secret from memory/DOM as soon as it is used
          setShowPw(false);
          setDone({ email: res.email });
          toast.success('Admin password reset');
        },
        onError: (e) => {
          const data = (e as { response?: { status?: number; data?: { admins?: AdminChoice[] } } })?.response;
          if (data?.status === 409 && Array.isArray(data.data?.admins)) {
            setAdmins(data.data.admins);
          }
          setValue('superAdminPassword', '', { shouldValidate: true });
        },
      },
    );
  };

  const generate = () => {
    const p = generateStrongPassword();
    setValue('newPassword', p, { shouldValidate: true, shouldDirty: true });
    setValue('confirmPassword', p, { shouldValidate: true, shouldDirty: true });
    setShowPw(true);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(form.getValues('newPassword'));
      toast.success('Copied to the clipboard');
    } catch {
      toast.error('Could not copy to the clipboard');
    }
  };

  const errors = formState.errors;

  return (
    <Dialog open={open} onOpenChange={(o) => !mutation.isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Reset admin password{admin ? `: ${admin.email}` : ''}</DialogTitle>
        </DialogHeader>

        {done ? (
          <div className="space-y-4">
            <p role="status" className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">
              The password for <strong>{done.email}</strong> was reset. All of their existing sessions were revoked, so they must sign in again with the new password.
            </p>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Close</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <p className="text-sm text-muted-foreground">
              Sets a new password for a vendor admin of <strong>{vendorName}</strong> and signs them out everywhere. You must confirm with your own password.
            </p>

            {needsPicker && (
              <div className="space-y-1.5">
                <Label htmlFor="rp-admin">Which admin?</Label>
                <select id="rp-admin" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" {...register('adminUserId')}>
                  <option value="">Select an admin…</option>
                  {admins.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.email})
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">This vendor has several admins. Choose the one to reset.</p>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="rp-new">New password</Label>
              <div className="flex gap-2">
                <Input id="rp-new" type={showPw ? 'text' : 'password'} autoComplete="new-password" {...register('newPassword')} />
                <Button type="button" variant="outline" size="icon" aria-label={showPw ? 'Hide password' : 'Show password'} onClick={() => setShowPw((s) => !s)}>
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
                <Button type="button" variant="outline" size="icon" aria-label="Copy password" onClick={copy}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <button type="button" className="inline-flex items-center gap-1 text-xs text-primary underline" onClick={generate}>
                <Wand2 className="h-3 w-3" /> Generate strong password
              </button>
              {errors.newPassword && <p className="text-sm text-destructive">{errors.newPassword.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rp-confirm">Confirm new password</Label>
              <Input id="rp-confirm" type={showPw ? 'text' : 'password'} autoComplete="new-password" {...register('confirmPassword')} />
              {errors.confirmPassword && <p className="text-sm text-destructive">{errors.confirmPassword.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rp-super">Your (super admin) password</Label>
              <Input id="rp-super" type="password" autoComplete="current-password" {...register('superAdminPassword')} />
              {errors.superAdminPassword && <p className="text-sm text-destructive">{errors.superAdminPassword.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rp-reason">Reason (optional, kept in the audit log)</Label>
              <Input id="rp-reason" maxLength={200} {...register('reason')} />
            </div>

            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 h-4 w-4" {...register('deliveryAck')} />
              <span>I will deliver this password to the admin over a secure channel.</span>
            </label>
            {errors.deliveryAck && <p className="text-sm text-destructive">{errors.deliveryAck.message}</p>}

            {mutation.error && (
              <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                {apiErrorMessage(mutation.error, 'Could not reset the password.')}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" disabled={mutation.isPending} onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive" disabled={!formState.isValid || !adminChosen || mutation.isPending}>
                {mutation.isPending ? 'Resetting…' : 'Reset password'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
