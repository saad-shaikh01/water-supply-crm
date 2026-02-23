'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Users, Map, Package, Truck,
  ClipboardList, CreditCard, UserCog, Droplets, Banknote, Navigation,
  Receipt, Bell, ScrollText, BarChart2
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
  group?: string;
}

const navItems: NavItem[] = [
  // Operations
  { label: 'Overview', href: '/dashboard/overview', icon: LayoutDashboard, minRole: 'STAFF', group: 'Operations' },
  { label: 'Customers', href: '/dashboard/customers', icon: Users, minRole: 'STAFF', group: 'Operations' },
  { label: 'Products', href: '/dashboard/products', icon: Package, minRole: 'STAFF', group: 'Operations' },
  { label: 'Routes', href: '/dashboard/routes', icon: Map, minRole: 'STAFF', group: 'Operations' },
  { label: 'Vans', href: '/dashboard/vans', icon: Truck, minRole: 'STAFF', group: 'Operations' },
  { label: 'Daily Sheets', href: '/dashboard/daily-sheets', icon: ClipboardList, minRole: 'DRIVER', group: 'Operations' },
  { label: 'Live Tracking', href: '/dashboard/tracking', icon: Navigation, minRole: 'STAFF', group: 'Operations' },
  // Finance
  { label: 'Transactions', href: '/dashboard/transactions', icon: CreditCard, minRole: 'STAFF', group: 'Finance' },
  { label: 'Payment Requests', href: '/dashboard/payment-requests', icon: Banknote, minRole: 'STAFF', group: 'Finance' },
  { label: 'Expenses', href: '/dashboard/expenses', icon: Receipt, minRole: 'STAFF', group: 'Finance' },
  { label: 'Analytics', href: '/dashboard/analytics', icon: BarChart2, minRole: 'VENDOR_ADMIN', group: 'Finance' },
  // Settings
  { label: 'Users', href: '/dashboard/users', icon: UserCog, minRole: 'VENDOR_ADMIN', group: 'Settings' },
  { label: 'Balance Reminders', href: '/dashboard/balance-reminders', icon: Bell, minRole: 'VENDOR_ADMIN', group: 'Settings' },
  { label: 'Audit Logs', href: '/dashboard/audit-logs', icon: ScrollText, minRole: 'VENDOR_ADMIN', group: 'Settings' },
];

const GROUPS = ['Operations', 'Finance', 'Settings'];

export function Sidebar({ className }: { className?: string }) {
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);

  const visibleItems = navItems.filter((item) =>
    user ? hasMinRole(user.role, item.minRole) : false
  );

  return (
    <aside className={cn("flex flex-col border-r bg-card/10 backdrop-blur-2xl dark:bg-[#05070a]/80", className)}>
      <div className="h-20 flex items-center px-8 border-b border-white/5 bg-transparent">
        <Link href="/dashboard/overview" className="flex items-center gap-3 group">
          <div className="p-2 rounded-xl bg-primary/20 text-primary shadow-[0_0_15px_rgba(0,212,255,0.3)] group-hover:bg-primary group-hover:text-primary-foreground transition-all duration-500">
            <Droplets className="h-6 w-6" />
          </div>
          <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-br from-foreground via-primary to-primary/50 tracking-tight">
            WATER<span className="text-primary">CRM</span>
          </span>
        </Link>
      </div>

      <nav className="flex-1 p-6 overflow-y-auto scrollbar-none space-y-8 transition-opacity duration-300">
        {GROUPS.map((group) => {
          const groupItems = visibleItems.filter((item) => item.group === group);
          if (groupItems.length === 0) return null;
          return (
            <div key={group} className="space-y-2">
              <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-muted-foreground/50 px-4 mb-3">
                {group}
              </p>
              {groupItems.map((item) => {
                const Icon = item.icon;
                const isActive = pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'group relative flex items-center gap-4 px-4 py-3 rounded-2xl text-sm font-semibold transition-all duration-300',
                      isActive
                        ? 'bg-primary/10 text-primary shadow-[inset_0_0_20px_rgba(0,212,255,0.1)] border border-primary/20'
                        : 'text-muted-foreground hover:bg-muted/50 dark:hover:bg-white/5 hover:text-foreground'
                    )}
                  >
                    <Icon className={cn(
                      "h-5 w-5 transition-all duration-300",
                      isActive 
                        ? "text-primary drop-shadow-[0_0_8px_rgba(0,212,255,0.6)] scale-110" 
                        : "text-muted-foreground group-hover:text-primary group-hover:scale-110"
                    )} />
                    <span className="tracking-tight">{item.label}</span>
                    {isActive && (
                      <motion.div
                        layoutId="sidebar-active-pill"
                        className="absolute right-2 w-1.5 h-1.5 bg-primary rounded-full shadow-[0_0_10px_rgba(0,212,255,1)]"
                        transition={{ type: "spring", stiffness: 300, damping: 30 }}
                      />
                    )}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      <div className="p-6 border-t border-border dark:border-white/5 bg-muted/20 dark:bg-black/20">
        <div className="px-5 py-4 rounded-3xl bg-gradient-to-br from-foreground/5 to-transparent border border-border dark:border-white/5 shadow-2xl">
          <p className="text-[9px] uppercase tracking-widest font-bold text-primary/60">Operator</p>
          <p className="text-sm font-bold truncate text-foreground mt-1">{user?.name || 'User'}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
            <p className="text-[10px] text-muted-foreground uppercase font-semibold tracking-tight">{user?.role?.replace('_', ' ')}</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
