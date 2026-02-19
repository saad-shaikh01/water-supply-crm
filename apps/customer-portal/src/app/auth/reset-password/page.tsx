'use client';

import { Suspense, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Droplets, KeyRound, CheckCircle2, Loader2 } from 'lucide-react';
import { Card, CardContent, Button, Input, Label, Skeleton } from '@water-supply-crm/ui';
import { authApi } from '../../../features/auth/api/auth.api';
import { toast } from 'sonner';

function ResetPasswordForm() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get('token') ?? '';
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [isPending, setIsPending] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirm) {
      toast.error('Passwords do not match');
      return;
    }
    if (!token) {
      toast.error('Invalid reset link');
      return;
    }
    setIsPending(true);
    try {
      await authApi.resetPassword({ token, newPassword });
      setDone(true);
      setTimeout(() => router.push('/auth/login'), 3000);
    } catch {
      toast.error('Failed to reset password. The link may have expired.');
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Card className="bg-card/50 backdrop-blur-sm border-border/50 shadow-2xl">
      <CardContent className="p-6">
        {done ? (
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="h-14 w-14 rounded-2xl bg-emerald-500/10 flex items-center justify-center text-emerald-500">
              <CheckCircle2 className="h-7 w-7" />
            </div>
            <p className="font-bold text-center">Password changed successfully!</p>
            <p className="text-sm text-muted-foreground text-center">Redirecting to login...</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm font-semibold">New Password</Label>
              <Input
                type="password"
                placeholder="Min. 8 characters"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="h-11"
                required
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Confirm Password</Label>
              <Input
                type="password"
                placeholder="Repeat your password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="h-11"
                required
              />
            </div>
            <Button type="submit" className="w-full h-11 font-bold rounded-xl shadow-lg shadow-primary/20" disabled={isPending}>
              {isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Resetting...</>
              ) : (
                <><KeyRound className="mr-2 h-4 w-4" /> Reset Password</>
              )}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-primary/10 text-primary mb-2">
            <Droplets className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-black tracking-tight">Reset Password</h1>
          <p className="text-sm text-muted-foreground">Enter your new password below</p>
        </div>
        <Suspense fallback={<Skeleton className="h-48 w-full rounded-2xl" />}>
          <ResetPasswordForm />
        </Suspense>
      </div>
    </div>
  );
}
