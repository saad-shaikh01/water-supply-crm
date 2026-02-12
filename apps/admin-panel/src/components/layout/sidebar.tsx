'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@water-supply-crm/ui';
import { LayoutDashboard, Building2, Settings } from 'lucide-react';

const navItems = [
  { label: 'Overview',  href: '/',        icon: LayoutDashboard },
  { label: 'Vendors',   href: '/vendors',  icon: Building2 },
  { label: 'Settings',  href: '/settings', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <div className="w-64 border-r bg-card flex flex-col shrink-0">
      <div className="h-16 flex items-center px-6 border-b">
        <span className="text-xl font-bold text-primary">WaterCRM</span>
        <span className="ml-2 text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded font-medium">Admin</span>
      </div>
      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
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
