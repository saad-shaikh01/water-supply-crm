'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  Button, Input, Label,
} from '@water-supply-crm/ui';
import { Lock, Eye, EyeOff, Loader2 } from 'lucide-react';
import { useChangePassword } from '../hooks/use-profile';

interface ChangePasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface FormData {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export function ChangePasswordDialog({ open, onOpenChange }: ChangePasswordDialogProps) {
  const { mutate: changePassword, isPending } = useChangePassword();
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    reset,
    setError,
    formState: { errors },
  } = useForm<FormData>();

  const onSubmit = (data: FormData) => {
    if (data.newPassword !== data.confirmPassword) {
      setError('confirmPassword', { message: 'Passwords do not match' });
      return;
    }
    changePassword(
      { currentPassword: data.currentPassword, newPassword: data.newPassword },
      {
        onSuccess: () => {
          reset();
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="rounded-[2rem] max-w-md p-0 overflow-hidden bg-background/95 backdrop-blur-xl border-border/50">
        <div className="bg-primary/5 p-8 border-b border-border/50">
          <DialogHeader>
            <DialogTitle className="text-xl font-black flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-primary flex items-center justify-center text-primary-foreground shadow-lg shadow-primary/20">
                <Lock className="h-5 w-5" />
              </div>
              Change Password
            </DialogTitle>
          </DialogHeader>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="p-8 space-y-5">
          {/* Current Password */}
          <div className="space-y-2">
            <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">
              Current Password
            </Label>
            <div className="relative">
              <Input
                type={showCurrent ? 'text' : 'password'}
                placeholder="Enter current password"
                className="h-12 rounded-xl pr-10"
                {...register('currentPassword', { required: 'Required' })}
              />
              <button
                type="button"
                onClick={() => setShowCurrent((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {errors.currentPassword && (
              <p className="text-xs text-destructive">{errors.currentPassword.message}</p>
            )}
          </div>

          {/* New Password */}
          <div className="space-y-2">
            <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">
              New Password
            </Label>
            <div className="relative">
              <Input
                type={showNew ? 'text' : 'password'}
                placeholder="Min. 6 characters"
                className="h-12 rounded-xl pr-10"
                {...register('newPassword', {
                  required: 'Required',
                  minLength: { value: 6, message: 'At least 6 characters' },
                })}
              />
              <button
                type="button"
                onClick={() => setShowNew((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {errors.newPassword && (
              <p className="text-xs text-destructive">{errors.newPassword.message}</p>
            )}
          </div>

          {/* Confirm Password */}
          <div className="space-y-2">
            <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">
              Confirm New Password
            </Label>
            <Input
              type="password"
              placeholder="Repeat new password"
              className="h-12 rounded-xl"
              {...register('confirmPassword', { required: 'Required' })}
            />
            {errors.confirmPassword && (
              <p className="text-xs text-destructive">{errors.confirmPassword.message}</p>
            )}
          </div>

          <Button
            type="submit"
            className="w-full h-12 rounded-2xl font-black shadow-xl shadow-primary/20 active:scale-95 transition-all mt-2"
            disabled={isPending}
          >
            {isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Update Password'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
