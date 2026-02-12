'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Users, Map, Package, Truck,
  ClipboardList, CreditCard, UserCog,
} from 'lucide-react';
import { cn } from '@water-supply-crm/ui';
import { useAuthStore } from '../../store/auth.store';
import { hasMinRole, type Role } from '../../lib/rbac';

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
  { label: 'Users', href: '/dashboard/users', icon: UserCog, minRole: 'VENDOR_ADMIN' },
  { label: 'Daily Sheets', href: '/dashboard/daily-sheets', icon: ClipboardList, minRole: 'DRIVER' },
  { label: 'Transactions', href: '/dashboard/transactions', icon: CreditCard, minRole: 'STAFF' },
];

export function Sidebar() {
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);

  const visibleItems = navItems.filter((item) =>
    user ? hasMinRole(user.role, item.minRole) : false
  );

  return (
    <div className="w-64 border-r bg-card flex flex-col shrink-0">
      <div className="h-16 flex items-center px-6 border-b">
        <span className="text-xl font-bold text-primary">WaterCRM</span>
      </div>
      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {visibleItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
