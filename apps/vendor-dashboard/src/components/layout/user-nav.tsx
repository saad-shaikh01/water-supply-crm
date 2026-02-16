'use client';

import { LogOut } from 'lucide-react';
import {
  Avatar, AvatarFallback, Button,
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@water-supply-crm/ui';
import { useAuthStore } from '../../store/auth.store';
import { useLogout } from '../../features/auth/hooks/use-auth';

export function UserNav() {
  const user = useAuthStore((s) => s.user);
  const logout = useLogout();

  const initials = user?.name
    ?.split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) ?? 'U';

  return (
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
        <div className="p-1">
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
  );
}
