'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn, Sheet, SheetContent, SheetDescription, SheetTitle } from '@water-supply-crm/ui';
import { Droplets } from 'lucide-react';
import { motion } from 'framer-motion';
import { isNavActive, sortedNavItems } from '../../config/nav';
import { useAuthStore } from '../../store/auth.store';

function SidebarBody({ pillId, onNavigate }: { pillId: string; onNavigate?: () => void }) {
  const pathname = usePathname() ?? '/';
  const user = useAuthStore((s) => s.user);
  const items = sortedNavItems();

  return (
    <>
      <div className="h-16 flex items-center px-6 border-b bg-background/50 shrink-0">
        <Link href="/" onClick={onNavigate} className="flex items-center gap-2 group">
          <div className="p-1.5 rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-all duration-300">
            <Droplets className="h-6 w-6" />
          </div>
          <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-blue-600 tracking-tight">
            WaterCRM
          </span>
        </Link>
      </div>

      <nav aria-label="Main" className="flex-1 p-4 space-y-1.5 overflow-y-auto scrollbar-none">
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = isNavActive(item, pathname);

          return (
            <Link
              key={item.id}
              href={item.href}
              onClick={onNavigate}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'group relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200',
                isActive
                  ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/25'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
            >
              <Icon className={cn(
                "h-5 w-5 transition-transform duration-200 group-hover:scale-110",
                isActive ? "text-primary-foreground" : "text-muted-foreground group-hover:text-accent-foreground"
              )} />
              <span>{item.label}</span>
              {isActive && (
                <motion.div
                  layoutId={pillId}
                  className="absolute left-0 w-1 h-6 bg-primary-foreground rounded-r-full"
                  transition={{ type: "spring", stiffness: 300, damping: 30 }}
                />
              )}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t bg-background/50 shrink-0">
        <div className="px-4 py-3 rounded-2xl bg-primary/5 border border-primary/10">
          <p className="text-[10px] uppercase tracking-widest font-bold text-primary">System Role</p>
          <p className="text-sm font-black mt-0.5">{user?.name ?? 'Platform Admin'}</p>
          <p className="text-[11px] text-muted-foreground font-medium">
            {user?.role ? user.role.replace(/_/g, ' ') : 'Platform Controller'}
          </p>
        </div>
      </div>
    </>
  );
}

/** Desktop (lg+) fixed sidebar. Hidden below lg, where MobileNav takes over. */
export function Sidebar() {
  return (
    <aside className="hidden lg:flex w-64 border-r bg-card/30 backdrop-blur-xl flex-col shrink-0">
      <SidebarBody pillId="sidebar-active-pill" />
    </aside>
  );
}

/** Off-canvas drawer (below lg). Radix Dialog supplies focus trap, Esc, backdrop and aria-modal. */
export function MobileNav({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const pathname = usePathname() ?? '/';
  useEffect(() => {
    // close whenever the route changes
    onOpenChange(false);
  }, [pathname]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        id="mobile-nav"
        className="lg:hidden w-64 max-w-[85vw] p-0 gap-0 flex flex-col bg-background"
        style={{ overflowY: 'hidden' }}
      >
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <SheetDescription className="sr-only">Main navigation menu</SheetDescription>
        <SidebarBody pillId="mobile-sidebar-active-pill" onNavigate={() => onOpenChange(false)} />
      </SheetContent>
    </Sheet>
  );
}
