'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@water-supply-crm/ui';
import { 
  LayoutDashboard, 
  Users, 
  Map, 
  Package, 
  Truck, 
  ClipboardList, 
  History, 
  Settings 
} from 'lucide-react';

const navItems = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Customers', href: '/customers', icon: Users },
  { label: 'Routes', href: '/routes', icon: Map },
  { label: 'Products', href: '/products', icon: Package },
  { label: 'Vans', href: '/vans', icon: Truck },
  { label: 'Daily Sheets', href: '/daily-sheets', icon: ClipboardList },
  { label: 'Ledger', href: '/ledger', icon: History },
  { label: 'Settings', href: '/settings', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <div className="w-64 border-r bg-card flex flex-col">
      <div className="h-16 flex items-center px-6 border-b">
        <span className="text-xl font-bold text-primary">WaterCRM</span>
      </div>
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;
          
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                isActive 
                  ? "bg-primary text-primary-foreground" 
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
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
