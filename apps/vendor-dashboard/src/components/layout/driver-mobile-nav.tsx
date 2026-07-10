'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, ClipboardList, ShieldAlert, History } from 'lucide-react';
import { cn } from '@water-supply-crm/ui';
import { pagePermissionForPath } from '@water-supply-crm/authz';
import { useAuthStore } from '../../store/auth.store';
import { usePermissions } from '../../features/authz/hooks/use-permissions';

// Each href resolves to a `:page` permission via the shared PAGE_REGISTRY
// (@water-supply-crm/authz) — no permission is hardcoded here.
const NAV_ITEMS = [
  { label: 'Home', href: '/dashboard/home', icon: Home },
  { label: 'Sheet', href: '/dashboard/daily-sheets', icon: ClipboardList },
  { label: 'Damage', href: '/dashboard/damage-report', icon: ShieldAlert },
  { label: 'History', href: '/dashboard/history', icon: History },
];

export function DriverMobileNav() {
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const { can } = usePermissions();

  // This compact bottom nav is a display mode for DRIVER users on mobile, not a
  // general permission surface (mirrors the Sidebar's "Driver" group); each item's
  // own visibility still resolves through the page registry below.
  if (user?.role !== 'DRIVER') return null;

  const visibleItems = NAV_ITEMS.filter(({ href }) => {
    const permission = pagePermissionForPath(href);
    return permission ? can(permission) : false;
  });

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex items-stretch bg-background/95 backdrop-blur-xl border-t border-border safe-area-bottom">
      {visibleItems.map(({ label, href, icon: Icon }) => {
        const isActive = pathname === href || (href !== '/dashboard/home' && pathname.startsWith(href));
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              'relative flex-1 flex flex-col items-center justify-center gap-1 py-3 text-[10px] font-semibold transition-colors',
              isActive ? 'text-primary' : 'text-muted-foreground',
            )}
          >
            <Icon
              className={cn('h-5 w-5 transition-colors', isActive ? 'text-primary' : 'text-muted-foreground')}
            />
            {label}
            {isActive && (
              <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-primary" />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
