/**
 * Navigation registry - the single source of truth for the sidebar.
 *
 * Rule: one array, one line per page. Later phases only ADD a line with a unique
 * `order` (never edit another phase's line) so concurrent PRs do not conflict.
 * Reserved orders: Overview 10, Vendors 20, Audit Logs 30, System Health 40,
 * WhatsApp 50, Billing 60, Announcements 70, Platform Admins 80, Security 90,
 * Settings 100.
 * Every non-root href MUST have a matching folder under src/app/(dashboard)
 * (enforced by config/nav.spec.ts).
 */
import type { LucideIcon } from 'lucide-react';
import { Building2, LayoutDashboard, Settings } from 'lucide-react';

export interface NavItem {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  order: number;
  match?: 'exact' | 'prefix';
}

export const NAV_ITEMS: NavItem[] = [
  { id: 'overview', label: 'Overview', href: '/', icon: LayoutDashboard, order: 10, match: 'exact' },
  { id: 'vendors', label: 'Vendors', href: '/vendors', icon: Building2, order: 20 },
  { id: 'settings', label: 'Settings', href: '/settings', icon: Settings, order: 100 },
];

export function sortedNavItems(items: NavItem[] = NAV_ITEMS): NavItem[] {
  return [...items].sort((a, b) => a.order - b.order);
}

export function isNavActive(item: NavItem, pathname: string): boolean {
  const mode = item.match ?? 'prefix';
  if (mode === 'exact') return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
