'use client';

import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import type { Permission } from '@water-supply-crm/authz';
import { usePermissions } from '../hooks/use-permissions';

interface CanProps {
  /** Exact permission required. Mutually exclusive with `any`/`all`. */
  permission?: Permission;
  /** Render children if the user holds any of these permissions. */
  any?: readonly Permission[];
  /** Render children if the user holds all of these permissions. */
  all?: readonly Permission[];
  children: ReactNode;
  /** Rendered instead of `children` when denied (ignored when `mode="disable"`). */
  fallback?: ReactNode;
  /**
   * `"hide"` (default) unmounts `children` on denial. `"disable"` instead clones the child
   * element with `disabled`/`aria-disabled`, for buttons that should stay visible but inert.
   */
  mode?: 'hide' | 'disable';
}

/**
 * Layer-3 declarative permission gate — the JSX counterpart to `useCan`/`useCanAny`/`useCanAll`.
 * Shares the exact same `usePermissions()` matcher, so there is one authorization check in the
 * whole app, never a second hand-rolled comparison.
 */
export function Can({ permission, any, all, children, fallback = null, mode = 'hide' }: CanProps) {
  const { can, canAny, canAll } = usePermissions();

  const allowed = permission ? can(permission) : any ? canAny(any) : all ? canAll(all) : false;

  if (allowed) return <>{children}</>;

  if (mode === 'disable' && isValidElement(children)) {
    return cloneElement(
      children as ReactElement<{ disabled?: boolean; 'aria-disabled'?: boolean }>,
      { disabled: true, 'aria-disabled': true },
    );
  }

  return <>{fallback}</>;
}
