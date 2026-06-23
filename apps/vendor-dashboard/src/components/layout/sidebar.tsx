'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Users, Map, Package, Truck,
  ClipboardList, CreditCard, UserCog, Droplets, Banknote, Navigation,
  Receipt, Bell, ScrollText, BarChart2, Home, History, ShoppingCart,
  MessageSquare, AlertTriangle, Tag, ShieldAlert, Warehouse, Wrench, ChevronDown,
} from 'lucide-react';
import { cn } from '@water-supply-crm/ui';
import { useAuthStore } from '../../store/auth.store';
import { hasMinRole, type Role } from '../../lib/rbac';
import { useState, useEffect } from 'react';

interface ChildNavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  minRole: Role;
}

interface NavItem {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  minRole: Role;
  group: string;
  href?: string;
  children?: ChildNavItem[];
}

const navItems: NavItem[] = [
  // Driver
  { label: 'Home', href: '/dashboard/home', icon: Home, minRole: 'DRIVER', group: 'Driver' },
  { label: 'My History', href: '/dashboard/history', icon: History, minRole: 'DRIVER', group: 'Driver' },
  // Operations — core flat links
  { label: 'Overview', href: '/dashboard/overview', icon: LayoutDashboard, minRole: 'STAFF', group: 'Operations' },
  { label: 'Customers', href: '/dashboard/customers', icon: Users, minRole: 'DRIVER', group: 'Operations' },
  { label: 'Daily Sheets', href: '/dashboard/daily-sheets', icon: ClipboardList, minRole: 'DRIVER', group: 'Operations' },

  // Operations — collapsible: Inventory & Supply
  {
    label: 'Inventory & Supply',
    icon: Package,
    minRole: 'STAFF',
    group: 'Operations',
    children: [
      { label: 'Products', href: '/dashboard/products', icon: Package, minRole: 'STAFF' },
      { label: 'Routes', href: '/dashboard/routes', icon: Map, minRole: 'STAFF' },
      { label: 'Vans', href: '/dashboard/vans', icon: Truck, minRole: 'STAFF' },
      { label: 'Live Tracking', href: '/dashboard/tracking', icon: Navigation, minRole: 'STAFF' },
      { label: 'Pricing', href: '/dashboard/pricing', icon: Tag, minRole: 'VENDOR_ADMIN' },
    ],
  },

  // Operations — collapsible: Warehouse
  {
    label: 'Warehouse',
    icon: Warehouse,
    minRole: 'STAFF',
    group: 'Operations',
    children: [
      { label: 'Stock Overview', href: '/dashboard/warehouse', icon: Warehouse, minRole: 'STAFF' },
      { label: 'Repairs', href: '/dashboard/warehouse/repairs', icon: Wrench, minRole: 'STAFF' },
      { label: 'Summary', href: '/dashboard/warehouse/summary', icon: BarChart2, minRole: 'STAFF' },
    ],
  },

  // Operations — collapsible: Customer Services
  {
    label: 'Customer Services',
    icon: MessageSquare,
    minRole: 'STAFF',
    group: 'Operations',
    children: [
      { label: 'Orders', href: '/dashboard/orders', icon: ShoppingCart, minRole: 'STAFF' },
      { label: 'Tickets', href: '/dashboard/tickets', icon: MessageSquare, minRole: 'STAFF' },
      { label: 'Delivery Issues', href: '/dashboard/delivery-issues', icon: AlertTriangle, minRole: 'STAFF' },
      { label: 'Damage Cases', href: '/dashboard/damage-cases', icon: ShieldAlert, minRole: 'STAFF' },
    ],
  },

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

const GROUPS = ['Driver', 'Operations', 'Finance', 'Settings'];

function CollapsibleNavGroup({
  item,
  pathname,
  userRole,
}: {
  item: NavItem & { children: ChildNavItem[] };
  pathname: string;
  userRole: Role;
}) {
  const visibleChildren = item.children.filter((child) =>
    hasMinRole(userRole, child.minRole)
  );

  const isAnyChildActive = visibleChildren.some((child) =>
    pathname.startsWith(child.href)
  );

  const [isOpen, setIsOpen] = useState(isAnyChildActive);

  useEffect(() => {
    if (isAnyChildActive) setIsOpen(true);
  }, [isAnyChildActive]);

  if (visibleChildren.length === 0) return null;

  const Icon = item.icon;

  return (
    <div>
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        className={cn(
          'group w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
          isAnyChildActive
            ? 'text-zinc-900 dark:text-primary'
            : 'text-zinc-500 hover:bg-zinc-100/80 hover:text-zinc-900 dark:text-muted-foreground dark:hover:bg-white/5 dark:hover:text-foreground'
        )}
      >
        <Icon
          className={cn(
            'h-4 w-4 flex-shrink-0 transition-colors',
            isAnyChildActive
              ? 'text-primary'
              : 'text-zinc-400 group-hover:text-primary dark:text-muted-foreground'
          )}
        />
        <span className="flex-1 text-left tracking-tight">{item.label}</span>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 flex-shrink-0 transition-transform duration-200 text-zinc-400 dark:text-muted-foreground/60',
            isOpen && 'rotate-180'
          )}
        />
      </button>

      {isOpen && (
        <div className="ml-4 mt-0.5 mb-1 border-l border-zinc-200 dark:border-border/40 pl-3 space-y-0.5">
          {visibleChildren.map((child) => {
            const ChildIcon = child.icon;
            const isActive = pathname.startsWith(child.href);
            return (
              <Link
                key={child.href}
                href={child.href}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
                  isActive
                    ? 'bg-zinc-100 text-zinc-900 font-medium dark:bg-primary/10 dark:text-primary'
                    : 'text-zinc-500 hover:bg-zinc-100/80 hover:text-zinc-900 dark:text-muted-foreground dark:hover:bg-white/5 dark:hover:text-foreground'
                )}
              >
                <ChildIcon
                  className={cn(
                    'h-3.5 w-3.5 flex-shrink-0',
                    isActive ? 'text-primary' : 'text-zinc-400 dark:text-muted-foreground'
                  )}
                />
                <span>{child.label}</span>
                {isActive && (
                  <div className="ml-auto w-1 h-1 bg-primary rounded-full shadow-[0_0_8px_rgba(99,102,241,0.8)]" />
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Sidebar({ className }: { className?: string }) {
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);

  const visibleItems = navItems.filter((item) => {
    if (!user) return false;
    if (item.group === 'Driver') return user.role === 'DRIVER';
    return hasMinRole(user.role, item.minRole);
  });

  return (
    <aside className={cn('flex flex-col border-r border-zinc-200/80 bg-white dark:border-border dark:bg-zinc-950', className)}>
      <div className="h-16 flex items-center px-6 border-b border-zinc-200/80 dark:border-border/50">
        <Link href="/dashboard/overview" className="flex items-center gap-2.5 group">
          <div className="p-1.5 rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-white transition-colors">
            <Droplets className="h-5 w-5" />
          </div>
          <span className="text-lg font-bold text-zinc-900 dark:text-white tracking-tight">
            WATER<span className="text-primary">CRM</span>
          </span>
        </Link>
      </div>

      <nav className="flex-1 px-3 py-4 overflow-y-auto scrollbar-none space-y-6">
        {GROUPS.map((group) => {
          const groupItems = visibleItems.filter((item) => item.group === group);
          if (groupItems.length === 0) return null;

          return (
            <div key={group} className="space-y-0.5">
              <p className="text-[10px] uppercase tracking-[0.18em] font-semibold text-zinc-400 dark:text-muted-foreground/40 px-3 mb-2">
                {group}
              </p>
              {groupItems.map((item) => {
                if (item.children && user) {
                  return (
                    <CollapsibleNavGroup
                      key={item.label}
                      item={item as NavItem & { children: ChildNavItem[] }}
                      pathname={pathname}
                      userRole={user.role as Role}
                    />
                  );
                }

                const Icon = item.icon;
                const isActive = item.href ? pathname.startsWith(item.href) : false;
                return (
                  <Link
                    key={item.href}
                    href={item.href!}
                    className={cn(
                      'group relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors',
                      isActive
                        ? 'bg-zinc-100 text-zinc-900 font-medium dark:bg-primary/10 dark:text-primary dark:border dark:border-primary/20'
                        : 'text-zinc-500 hover:bg-zinc-100/80 hover:text-zinc-900 dark:text-muted-foreground dark:hover:bg-white/5 dark:hover:text-foreground'
                    )}
                  >
                    <Icon
                      className={cn(
                        'h-4 w-4 flex-shrink-0 transition-colors',
                        isActive
                          ? 'text-primary'
                          : 'text-zinc-400 group-hover:text-primary dark:text-muted-foreground'
                      )}
                    />
                    <span className="tracking-tight">{item.label}</span>
                    {isActive && (
                      <div className="absolute right-3 w-1 h-1 bg-primary rounded-full shadow-[0_0_8px_rgba(99,102,241,0.8)]" />
                    )}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      <div className="px-3 py-4 border-t border-zinc-200/80 dark:border-border/50">
        <div className="px-4 py-3 rounded-xl bg-zinc-50 border border-zinc-200/80 dark:bg-white/[0.03] dark:border-border/50">
          <p className="text-[9px] uppercase tracking-widest font-bold text-primary">
            {user?.role === 'DRIVER' ? 'Driver' : 'Operator'}
          </p>
          <p className="text-sm font-semibold truncate text-zinc-900 dark:text-white mt-0.5">{user?.name || 'User'}</p>
          <div className="flex items-center gap-1.5 mt-1">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]" />
            <p className="text-[10px] text-zinc-400 dark:text-muted-foreground uppercase font-medium tracking-tight">
              {user?.role?.replace('_', ' ')}
            </p>
          </div>
        </div>
      </div>
    </aside>
  );
}
