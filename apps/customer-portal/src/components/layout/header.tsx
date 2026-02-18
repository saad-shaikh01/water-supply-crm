'use client';

import { useLogout } from '../../features/auth/hooks/use-auth';
import { useAuthStore } from '../../store/auth.store';
import { 
  Button, Avatar, AvatarFallback, 
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, 
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger 
} from '@water-supply-crm/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Receipt, User, LogOut, Droplets, Bell, CreditCard, Truck, CalendarDays } from 'lucide-react';
import { ThemeToggle } from './theme-toggle';
import { cn } from '@water-supply-crm/ui';

const navItems = [
  { href: '/home', label: 'Home' },
  { href: '/deliveries', label: 'Deliveries' },
  { href: '/payments', label: 'Payments' },
  { href: '/transactions', label: 'History' },
  { href: '/profile', label: 'Profile' },
];

export function Header() {
  const user = useAuthStore((s) => s.user);
  const logout = useLogout();
  const pathname = usePathname();

  const initials = user?.name
    ? user.name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
    : 'C';

  return (
    <header className="h-16 border-b bg-background/50 backdrop-blur-xl sticky top-0 z-40 w-full flex items-center justify-between px-4 md:px-6">
      <div className="flex items-center gap-2">
        <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
          <Droplets className="h-5 w-5" />
        </div>
        <span className="text-xl font-black tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-primary to-blue-600">
          WaterCRM
        </span>
      </div>

      {/* Desktop Nav */}
      <nav className="hidden sm:flex items-center gap-1 bg-muted/30 p-1 rounded-full border border-border/50">
        {navItems.map(({ href, label }) => {
          const isActive = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "px-4 py-1.5 rounded-full text-xs font-bold transition-all duration-300",
                isActive 
                  ? "bg-background text-primary shadow-sm shadow-black/5" 
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="flex items-center gap-2 md:gap-3">
        <ThemeToggle />
        <Button variant="ghost" size="icon" className="relative text-muted-foreground h-9 w-9 rounded-full hover:bg-accent dark:hover:bg-white/5 transition-colors">
          <Bell className="h-5 w-5" />
          <span className="absolute top-2.5 right-2.5 w-2 h-2 bg-destructive rounded-full border-2 border-background" />
        </Button>
        <div className="h-8 w-[1px] bg-border/50 mx-1 hidden sm:block" />
        
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="relative h-9 w-9 rounded-full p-0 ring-offset-background hover:ring-2 hover:ring-primary/20 transition-all">
              <Avatar className="h-9 w-9 border border-border/50">
                <AvatarFallback className="text-[10px] font-black bg-gradient-to-br from-primary to-blue-600 text-primary-foreground">
                  {initials}
                </AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64 p-2 bg-background/95 backdrop-blur-xl border-border/50 rounded-2xl shadow-2xl mt-2">
            <DropdownMenuLabel className="font-normal px-2 py-3">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-black">
                  {initials}
                </div>
                <div className="flex flex-col space-y-0.5 min-w-0">
                  <p className="text-sm font-bold truncate leading-none">{user?.name || 'Customer'}</p>
                  <p className="text-[11px] text-muted-foreground truncate leading-none">{user?.email || ''}</p>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator className="bg-border/50" />
            <div className="p-1">
              <DropdownMenuItem asChild className="rounded-xl px-3 py-2 cursor-pointer transition-all">
                <Link href="/profile" className="flex items-center">
                  <User className="mr-3 h-4 w-4" />
                  <span className="font-bold text-sm">Account Settings</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={logout} className="text-destructive focus:text-destructive focus:bg-destructive/10 rounded-xl px-3 py-2 cursor-pointer transition-all">
                <LogOut className="mr-3 h-4 w-4" />
                <span className="font-bold text-sm">Logout</span>
              </DropdownMenuItem>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
