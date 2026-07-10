'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { pagePermissionForPath } from '@water-supply-crm/authz';
import { usePermissions } from '../../features/authz/hooks/use-permissions';
import { AccessDenied } from './access-denied';

/**
 * Layer-2 route protection: resolves the current pathname to its `:page` permission via the
 * shared Page Registry and renders `<AccessDenied/>` on a miss — so a hand-typed URL to a page
 * hidden from the sidebar still can't be reached. A route with no registry entry also denies
 * (fail-closed), matching the backend's deny-by-default posture. This is UX only; every page's
 * data endpoints independently enforce their own permissions server-side.
 */
export function RouteGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { can, isLoading } = usePermissions();

  if (isLoading) {
    return (
      <div className="h-[60vh] flex flex-col items-center justify-center space-y-4 animate-in fade-in duration-500">
        <div className="h-12 w-12 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
        <p className="text-sm font-bold text-muted-foreground animate-pulse">Checking access...</p>
      </div>
    );
  }

  const permission = pagePermissionForPath(pathname);
  if (!permission || !can(permission)) {
    return <AccessDenied />;
  }

  return <>{children}</>;
}
