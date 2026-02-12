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
        <Button variant="ghost" className="relative h-9 w-9 rounded-full">
          <Avatar className="h-9 w-9">
            <AvatarFallback className="bg-primary text-primary-foreground text-sm">
              {initials}
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="end" forceMount>
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium leading-none">{user?.name ?? 'User'}</p>
            <p className="text-xs leading-none text-muted-foreground">{user?.email ?? ''}</p>
            <p className="text-xs leading-none text-muted-foreground capitalize">
              {user?.role?.toLowerCase().replace('_', ' ') ?? ''}
            </p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={logout}
          className="cursor-pointer text-destructive focus:text-destructive"
        >
          <LogOut className="mr-2 h-4 w-4" />
          Sign Out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
