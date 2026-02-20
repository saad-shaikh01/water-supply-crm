'use client';

import { useState } from 'react';
import { LogOut, KeyRound } from 'lucide-react';
import {
  Avatar, AvatarFallback, Button,
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Input, Label,
} from '@water-supply-crm/ui';
import { useAuthStore } from '../../store/auth.store';
import { useLogout } from '../../features/auth/hooks/use-auth';
import { useChangePassword } from '../../features/users/hooks/use-users';

export function UserNav() {
  const user = useAuthStore((s) => s.user);
  const logout = useLogout();
  const { mutate: changePassword, isPending } = useChangePassword();

  const [pwOpen, setPwOpen] = useState(false);
  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [pwError, setPwError] = useState('');

  const initials = user?.name
    ?.split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) ?? 'U';

  const handleChangePassword = () => {
    if (pwForm.newPassword !== pwForm.confirm) {
      setPwError('New passwords do not match');
      return;
    }
    if (pwForm.newPassword.length < 6) {
      setPwError('Password must be at least 6 characters');
      return;
    }
    setPwError('');
    changePassword(
      { currentPassword: pwForm.currentPassword, newPassword: pwForm.newPassword },
      { onSuccess: () => { setPwOpen(false); setPwForm({ currentPassword: '', newPassword: '', confirm: '' }); } }
    );
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="relative h-9 w-9 rounded-full ring-offset-background transition-all hover:ring-2 hover:ring-primary/20">
            <Avatar className="h-9 w-9 border border-border/50">
              <AvatarFallback className="bg-gradient-to-br from-primary to-blue-600 text-primary-foreground text-xs font-bold shadow-inner">
                {initials}
              </AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-64 p-2 bg-background/95 backdrop-blur-xl border-border/50 rounded-2xl shadow-2xl" align="end" forceMount>
          <DropdownMenuLabel className="font-normal px-2 py-3">
            <div className="flex items-center gap-3">
              <Avatar className="h-10 w-10 border border-border/50">
                <AvatarFallback className="bg-primary/10 text-primary text-xs font-bold">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-col space-y-0.5 min-w-0">
                <p className="text-sm font-bold leading-none truncate">{user?.name ?? 'User'}</p>
                <p className="text-[11px] leading-none text-muted-foreground truncate">{user?.email ?? ''}</p>
                <div className="mt-1">
                  <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-bold uppercase tracking-tighter capitalize">
                    {user?.role?.toLowerCase().replace('_', ' ') ?? ''}
                  </span>
                </div>
              </div>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator className="bg-border/50" />
          <div className="p-1 space-y-0.5">
            <DropdownMenuItem
              onClick={() => setPwOpen(true)}
              className="cursor-pointer rounded-xl px-3 py-2.5 transition-all duration-200"
            >
              <KeyRound className="mr-3 h-4 w-4" />
              <span className="font-bold text-sm">Change Password</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={logout}
              className="cursor-pointer text-destructive focus:text-destructive focus:bg-destructive/10 rounded-xl px-3 py-2.5 transition-all duration-200"
            >
              <LogOut className="mr-3 h-4 w-4" />
              <span className="font-bold text-sm">Sign Out</span>
            </DropdownMenuItem>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={pwOpen} onOpenChange={setPwOpen}>
        <DialogContent className="rounded-3xl max-w-sm bg-background/95 backdrop-blur-xl border-border/50">
          <DialogHeader>
            <DialogTitle className="text-xl font-black flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-primary" /> Change Password
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">Current Password</Label>
              <Input
                type="password"
                placeholder="••••••••"
                className="h-11"
                value={pwForm.currentPassword}
                onChange={e => setPwForm(p => ({ ...p, currentPassword: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">New Password</Label>
              <Input
                type="password"
                placeholder="••••••••"
                className="h-11"
                value={pwForm.newPassword}
                onChange={e => setPwForm(p => ({ ...p, newPassword: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">Confirm New Password</Label>
              <Input
                type="password"
                placeholder="••••••••"
                className="h-11"
                value={pwForm.confirm}
                onChange={e => setPwForm(p => ({ ...p, confirm: e.target.value }))}
              />
            </div>
            {pwError && <p className="text-xs text-destructive font-bold">{pwError}</p>}
          </div>
          <DialogFooter className="gap-3 border-t pt-6 mt-2">
            <Button variant="ghost" onClick={() => setPwOpen(false)} className="rounded-xl">Cancel</Button>
            <Button
              onClick={handleChangePassword}
              disabled={isPending || !pwForm.currentPassword || !pwForm.newPassword}
              className="rounded-xl font-bold shadow-lg shadow-primary/20"
            >
              {isPending ? 'Updating...' : 'Update Password'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
