'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Users, Map, Package, Truck,
  ClipboardList, CreditCard, UserCog, Droplets, Banknote, Navigation
} from 'lucide-react';
import { cn } from '@water-supply-crm/ui';
import { useAuthStore } from '../../store/auth.store';
import { hasMinRole, type Role } from '../../lib/rbac';
import { motion } from 'framer-motion';

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  minRole: Role;
}

const navItems: NavItem[] = [
  { label: 'Overview', href: '/dashboard/overview', icon: LayoutDashboard, minRole: 'STAFF' },
  { label: 'Customers', href: '/dashboard/customers', icon: Users, minRole: 'STAFF' },
  { label: 'Products', href: '/dashboard/products', icon: Package, minRole: 'STAFF' },
  { label: 'Routes', href: '/dashboard/routes', icon: Map, minRole: 'STAFF' },
  { label: 'Vans', href: '/dashboard/vans', icon: Truck, minRole: 'STAFF' },
  { label: 'Daily Sheets', href: '/dashboard/daily-sheets', icon: ClipboardList, minRole: 'DRIVER' },
  { label: 'Live Tracking', href: '/dashboard/tracking', icon: Navigation, minRole: 'STAFF' },
  { label: 'Transactions', href: '/dashboard/transactions', icon: CreditCard, minRole: 'STAFF' },
  { label: 'Payment Requests', href: '/dashboard/payment-requests', icon: Banknote, minRole: 'STAFF' },
  { label: 'Users', href: '/dashboard/users', icon: UserCog, minRole: 'VENDOR_ADMIN' },
];

export function Sidebar({ className }: { className?: string }) {
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);

  const visibleItems = navItems.filter((item) =>
    user ? hasMinRole(user.role, item.minRole) : false
  );

  return (
    <aside className={cn("flex flex-col border-r bg-card/30 backdrop-blur-xl dark:bg-zinc-950/50", className)}>
      <div className="h-16 flex items-center px-6 border-b bg-background/50 dark:bg-transparent">
        <Link href="/dashboard/overview" className="flex items-center gap-2 group">
          <div className="p-1.5 rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-all duration-300">
            <Droplets className="h-6 w-6" />
          </div>
          <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-blue-600 dark:from-primary dark:to-blue-400 tracking-tight">
            WaterCRM
          </span>
        </Link>
      </div>
      
      <nav className="flex-1 p-4 space-y-1.5 overflow-y-auto scrollbar-none">
        {visibleItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname.startsWith(item.href);
          
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'group relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200',
                isActive
                  ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/25 dark:shadow-primary/10'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground dark:hover:bg-white/5'
              )}
            >
              <Icon className={cn(
                "h-5 w-5 transition-transform duration-200 group-hover:scale-110",
                isActive ? "text-primary-foreground" : "text-muted-foreground group-hover:text-accent-foreground"
              )} />
              <span>{item.label}</span>
              {isActive && (
                <motion.div
                  layoutId="sidebar-active-pill"
                  className="absolute left-0 w-1 h-6 bg-primary-foreground rounded-r-full"
                  transition={{ type: "spring", stiffness: 300, damping: 30 }}
                />
              )}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t bg-background/50 dark:bg-transparent">
        <div className="px-4 py-3 rounded-2xl bg-accent/50 dark:bg-white/5 border border-border/50">
          <p className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground/70">Logged in as</p>
          <p className="text-sm font-bold truncate mt-0.5">{user?.name || 'User'}</p>
          <p className="text-[11px] text-muted-foreground truncate capitalize font-medium">{user?.role?.toLowerCase().replace('_', ' ')}</p>
        </div>
      </div>
    </aside>
  );
}
