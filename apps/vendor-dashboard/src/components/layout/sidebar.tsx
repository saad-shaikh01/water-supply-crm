'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Users, Map, Package, Truck,
  ClipboardList, CreditCard, UserCog, Droplets, Banknote, Navigation,
  Receipt, Bell, BellRing, ScrollText, BarChart2, Home, History, ShoppingCart,
  MessageSquare, AlertTriangle, Tag, ShieldAlert, Warehouse, Wrench, ChevronDown, KeyRound,
} from 'lucide-react';
import { cn } from '@water-supply-crm/ui';
import { pagePermissionForPath } from '@water-supply-crm/authz';
import { useAuthStore } from '../../store/auth.store';
import { usePermissions } from '../../features/authz/hooks/use-permissions';
import { useState, useEffect } from 'react';

interface ChildNavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface NavItem {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  group: string;
  href?: string;
  children?: ChildNavItem[];
}

// Every href below resolves to a `:page` permission via the shared PAGE_REGISTRY
// (@water-supply-crm/authz) — no permission is hardcoded here, so this list can never
// drift from the frozen catalog. See `canAccess()` in `Sidebar`/`CollapsibleNavGroup`.
const navItems: NavItem[] = [
  // Driver — display mode only shown to DRIVER users (see visibleItems filter below);
  // each item's own visibility still resolves through the page registry.
  { label: 'Home', href: '/dashboard/home', icon: Home, group: 'Driver' },
  { label: 'My History', href: '/dashboard/history', icon: History, group: 'Driver' },
  // Operations — core flat links
  { label: 'Overview', href: '/dashboard/overview', icon: LayoutDashboard, group: 'Operations' },
  { label: 'Customers', href: '/dashboard/customers', icon: Users, group: 'Operations' },
  { label: 'Daily Sheets', href: '/dashboard/daily-sheets', icon: ClipboardList, group: 'Operations' },

  // Operations — collapsible: Inventory & Supply
  {
    label: 'Inventory & Supply',
    icon: Package,
    group: 'Operations',
    children: [
      { label: 'Products', href: '/dashboard/products', icon: Package },
      { label: 'Routes', href: '/dashboard/routes', icon: Map },
      { label: 'Vans', href: '/dashboard/vans', icon: Truck },
      { label: 'Live Tracking', href: '/dashboard/tracking', icon: Navigation },
      { label: 'Pricing', href: '/dashboard/pricing', icon: Tag },
    ],
  },

  // Operations — collapsible: Warehouse
  {
    label: 'Warehouse',
    icon: Warehouse,
    group: 'Operations',
    children: [
      { label: 'Stock Overview', href: '/dashboard/warehouse', icon: Warehouse },
      { label: 'Repairs', href: '/dashboard/warehouse/repairs', icon: Wrench },
      { label: 'Summary', href: '/dashboard/warehouse/summary', icon: BarChart2 },
    ],
  },

  // Operations — collapsible: Customer Services
  {
    label: 'Customer Services',
    icon: MessageSquare,
    group: 'Operations',
    children: [
      { label: 'Orders', href: '/dashboard/orders', icon: ShoppingCart },
      { label: 'Tickets', href: '/dashboard/tickets', icon: MessageSquare },
      { label: 'Delivery Issues', href: '/dashboard/delivery-issues', icon: AlertTriangle },
      { label: 'Damage Cases', href: '/dashboard/damage-cases', icon: ShieldAlert },
    ],
  },

  // Finance
  { label: 'Transactions', href: '/dashboard/transactions', icon: CreditCard, group: 'Finance' },
  { label: 'Payment Requests', href: '/dashboard/payment-requests', icon: Banknote, group: 'Finance' },
  { label: 'Expenses', href: '/dashboard/expenses', icon: Receipt, group: 'Finance' },
  { label: 'Analytics', href: '/dashboard/analytics', icon: BarChart2, group: 'Finance' },

  // Settings
  { label: 'Users', href: '/dashboard/users', icon: UserCog, group: 'Settings' },
  { label: 'Roles & Access', href: '/dashboard/settings/roles', icon: KeyRound, group: 'Settings' },
  { label: 'Balance Reminders', href: '/dashboard/balance-reminders', icon: Bell, group: 'Settings' },
  { label: 'Notification Controls', href: '/dashboard/notification-settings', icon: BellRing, group: 'Settings' },
  { label: 'Audit Logs', href: '/dashboard/audit-logs', icon: ScrollText, group: 'Settings' },
];

const GROUPS = ['Driver', 'Operations', 'Finance', 'Settings'];

function CollapsibleNavGroup({
  item,
  pathname,
}: {
  item: NavItem & { children: ChildNavItem[] };
  pathname: string;
}) {
  const { can } = usePermissions();
  const visibleChildren = item.children.filter((child) => {
    const permission = pagePermissionForPath(child.href);
    return permission ? can(permission) : false;
  });

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
  const isHydrated = useAuthStore((s) => s.isHydrated);
  const { can, isLoading: permissionsLoading } = usePermissions();

  // Until the auth store has rehydrated AND permissions have resolved, we can't tell
  // "user has no access" from "haven't checked yet" — show a skeleton instead of
  // silently filtering every item out (which read as the sidebar going blank).
  const isReady = isHydrated && !permissionsLoading;

  const canAccess = (href: string) => {
    const permission = pagePermissionForPath(href);
    return permission ? can(permission) : false;
  };

  const visibleItems = isReady
    ? navItems.filter((item) => {
        if (!user) return false;
        // Driver nav is a display mode reserved for DRIVER users, same as DriverMobileNav;
        // each item's own visibility still resolves through the page registry below.
        if (item.group === 'Driver') {
          return user.role === 'DRIVER' && (item.href ? canAccess(item.href) : true);
        }
        // Collapsible groups have no href of their own — CollapsibleNavGroup hides the
        // whole group once none of its children resolve to a granted page permission.
        if (item.children) return true;
        return item.href ? canAccess(item.href) : false;
      })
    : [];

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
        {!isReady ? (
          <div className="space-y-1.5 px-1 animate-pulse" aria-hidden="true">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="h-9 rounded-lg bg-zinc-100 dark:bg-white/5" />
            ))}
          </div>
        ) : (
        GROUPS.map((group) => {
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
        })
        )}
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
