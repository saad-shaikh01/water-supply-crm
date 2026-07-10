'use client';

import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';
import { Button } from '@water-supply-crm/ui';
import { useAuthStore } from '../../store/auth.store';

/** Layer-2 render-time gate: shown by `RouteGuard` when the current route's `:page` permission is missing. */
export function AccessDenied() {
  const user = useAuthStore((s) => s.user);
  const homeHref = user?.role === 'DRIVER' ? '/dashboard/home' : '/dashboard/overview';

  return (
    <div className="h-[60vh] flex flex-col items-center justify-center text-center space-y-4 animate-in fade-in duration-500">
      <div className="p-4 rounded-full bg-destructive/10 text-destructive">
        <ShieldAlert className="h-10 w-10" />
      </div>
      <div className="space-y-1">
        <h1 className="text-lg font-bold text-foreground">Access Denied</h1>
        <p className="text-sm text-muted-foreground max-w-sm">
          You don&apos;t have permission to view this page. Contact your administrator if you
          believe this is a mistake.
        </p>
      </div>
      <Button asChild>
        <Link href={homeHref}>Back to dashboard</Link>
      </Button>
    </div>
  );
}
