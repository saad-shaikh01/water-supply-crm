'use client';

import { useLogout } from '../../features/auth/hooks/use-auth';
import { useAuthStore } from '../../store/auth.store';
import { Button } from '@water-supply-crm/ui';
import { LogOut, User } from 'lucide-react';

export function UserNav() {
  const logout = useLogout();
  const user = useAuthStore((s) => s.user);

  return (
    <div className="flex items-center gap-2">
      <div className="flex flex-col items-end mr-2">
        <span className="text-sm font-medium">{user?.name ?? 'Super Admin'}</span>
        <span className="text-xs text-muted-foreground">{user?.email ?? ''}</span>
      </div>
      <Button variant="ghost" size="icon" className="rounded-full bg-muted">
        <User className="h-5 w-5" />
      </Button>
      <Button variant="ghost" size="icon" onClick={() => logout()}>
        <LogOut className="h-4 w-4" />
      </Button>
    </div>
  );
}
