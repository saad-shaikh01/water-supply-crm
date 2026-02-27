'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Receipt, User, CreditCard, Truck, ShoppingCart, MessageCircle, CalendarDays, FileText, Menu } from 'lucide-react';
import { cn, Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@water-supply-crm/ui';

const primaryNavItems = [
  { href: '/home', label: 'Home', icon: Home },
  { href: '/deliveries', label: 'Deliveries', icon: Truck },
  { href: '/payments', label: 'Payments', icon: CreditCard },
  { href: '/orders', label: 'Orders', icon: ShoppingCart },
];

const moreNavItems = [
  { href: '/support', label: 'Support', icon: MessageCircle },
  { href: '/transactions', label: 'History', icon: Receipt },
  { href: '/schedule', label: 'Schedule', icon: CalendarDays },
  { href: '/statement', label: 'Statement', icon: FileText },
  { href: '/profile', label: 'Account', icon: User },
];

export function MobileNav() {
  const pathname = usePathname();
  const isMoreActive = moreNavItems.some((item) => item.href === pathname);

  return (
    <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-50 px-4 pb-4">
      <div className="bg-background/80 backdrop-blur-xl border border-border/50 rounded-2xl shadow-2xl flex items-center justify-around h-16 px-2 dark:glass-surface">
        {primaryNavItems.map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "relative flex flex-col items-center justify-center flex-1 h-full gap-1 transition-colors",
                isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className={cn("h-5 w-5", isActive && "scale-110")} />
              <span className="text-[9px] font-bold uppercase tracking-tighter">{label}</span>
              {isActive && (
                <div
                  className="absolute -top-2 w-10 h-1 bg-primary rounded-full shadow-[0_-4px_10px_rgba(99,102,241,0.5)]"
                />
              )}
            </Link>
          );
        })}

        <Sheet>
          <SheetTrigger asChild>
            <button
              type="button"
              className={cn(
                'relative flex flex-col items-center justify-center flex-1 h-full gap-1 transition-colors',
                isMoreActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Menu className={cn('h-5 w-5', isMoreActive && 'scale-110')} />
              <span className="text-[9px] font-bold uppercase tracking-tighter">More</span>
              {isMoreActive && <span className="absolute -top-2 w-10 h-1 bg-primary rounded-full" />}
            </button>
          </SheetTrigger>
          <SheetContent
            side="bottom"
            className="sm:hidden rounded-t-3xl border-x border-t border-border/50 bg-background/95 backdrop-blur-xl px-4 pb-8 pt-6 dark:glass-surface"
          >
            <SheetHeader className="space-y-1 text-left">
              <SheetTitle className="text-base">More Actions</SheetTitle>
              <SheetDescription>Quick access to all portal routes.</SheetDescription>
            </SheetHeader>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {moreNavItems.map(({ href, label, icon: Icon }) => {
                const isActive = pathname === href;
                return (
                  <SheetClose asChild key={href}>
                    <Link
                      href={href}
                      className={cn(
                        'flex items-center gap-3 rounded-xl border px-3 py-3 text-sm font-semibold transition-colors',
                        isActive
                          ? 'border-primary/40 bg-primary/10 text-primary'
                          : 'border-border/70 bg-background hover:bg-muted/60'
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span>{label}</span>
                    </Link>
                  </SheetClose>
                );
              })}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </nav>
  );
}
