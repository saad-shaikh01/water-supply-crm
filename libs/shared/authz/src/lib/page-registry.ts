/**
 * PAGE REGISTRY — the single mapping of vendor-dashboard routes to the `:page`
 * permission that gates them. Consumed by the sidebar, breadcrumbs, command
 * palette (Layer 1), the RouteGuard and edge middleware (Layer 2). Nested/detail
 * routes inherit their parent module's `:page` via longest-prefix match.
 *
 * Mirrors docs/rbac-permission-catalog.md §A + rbac-design.md §5.
 * `settings:page` is intentionally absent — the Settings landing page does not
 * exist yet (reserved capability); add its row here when the route is built.
 */
import type { PagePermission } from './permissions';

export interface PageRoute {
  /** Route prefix under /dashboard. Matches the exact path or any sub-path. */
  readonly prefix: string;
  /** The `:page` permission required to open this route. */
  readonly permission: PagePermission;
}

export const PAGE_REGISTRY: readonly PageRoute[] = [
  { prefix: '/dashboard/overview', permission: 'dashboard:page' },
  { prefix: '/dashboard/home', permission: 'dashboard:page' },
  { prefix: '/dashboard/users', permission: 'users:page' },
  { prefix: '/dashboard/settings/roles', permission: 'roles:page' },
  { prefix: '/dashboard/customers', permission: 'customers:page' },
  { prefix: '/dashboard/orders', permission: 'orders:page' },
  { prefix: '/dashboard/products', permission: 'products:page' },
  { prefix: '/dashboard/pricing', permission: 'pricing:page' },
  { prefix: '/dashboard/warehouse', permission: 'inventory:page' },
  { prefix: '/dashboard/payment-requests', permission: 'payments:page' },
  { prefix: '/dashboard/transactions', permission: 'transactions:page' },
  { prefix: '/dashboard/daily-sheets', permission: 'daily_sheets:page' },
  { prefix: '/dashboard/history', permission: 'daily_sheets:page' },
  { prefix: '/dashboard/vans', permission: 'vans:page' },
  { prefix: '/dashboard/routes', permission: 'routes:page' },
  { prefix: '/dashboard/tracking', permission: 'tracking:page' },
  { prefix: '/dashboard/delivery-issues', permission: 'delivery_issues:page' },
  { prefix: '/dashboard/damage-cases', permission: 'damage_cases:page' },
  { prefix: '/dashboard/damage-report', permission: 'damage_cases:page' },
  { prefix: '/dashboard/expenses', permission: 'expenses:page' },
  { prefix: '/dashboard/analytics', permission: 'analytics:page' },
  { prefix: '/dashboard/tickets', permission: 'tickets:page' },
  { prefix: '/dashboard/notification-settings', permission: 'notifications:page' },
  { prefix: '/dashboard/notification-logs', permission: 'notifications:page' },
  { prefix: '/dashboard/balance-reminders', permission: 'balance_reminders:page' },
  { prefix: '/dashboard/audit-logs', permission: 'audit_logs:page' },
  { prefix: '/dashboard/collection-policy', permission: 'collection_policy:page' },
  { prefix: '/dashboard/communications', permission: 'conversations:page' },
];

/**
 * Resolve a pathname to the `:page` permission that gates it, using longest-prefix
 * match so `/dashboard/settings/roles` wins over a shorter `/dashboard/settings`.
 * Returns null for routes with no registry entry (caller should default-deny).
 */
export function pagePermissionForPath(pathname: string): PagePermission | null {
  let best: PageRoute | null = null;
  for (const route of PAGE_REGISTRY) {
    const isMatch = pathname === route.prefix || pathname.startsWith(`${route.prefix}/`);
    if (isMatch && (!best || route.prefix.length > best.prefix.length)) {
      best = route;
    }
  }
  return best ? best.permission : null;
}
