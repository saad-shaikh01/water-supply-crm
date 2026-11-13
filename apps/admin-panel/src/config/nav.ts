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
import { Activity, Building2, CreditCard, FileUp, LayoutDashboard, Megaphone, MessageCircle, ScrollText, Settings, ShieldCheck, UserCog } from 'lucide-react';

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
  { id: 'audit-logs', label: 'Audit Logs', href: '/audit-logs', icon: ScrollText, order: 30 },
  { id: 'system-health', label: 'System Health', href: '/system-health', icon: Activity, order: 40 },
  { id: 'imports', label: 'Imports', href: '/imports', icon: FileUp, order: 45 },
  { id: 'whatsapp', label: 'WhatsApp', href: '/whatsapp', icon: MessageCircle, order: 50 },
  { id: 'billing', label: 'Billing', href: '/billing', icon: CreditCard, order: 60 },
  { id: 'announcements', label: 'Announcements', href: '/announcements', icon: Megaphone, order: 70 },
  { id: 'platform-admins', label: 'Platform Admins', href: '/settings/admins', icon: UserCog, order: 80 },
  { id: 'security', label: 'Security', href: '/settings/security', icon: ShieldCheck, order: 90 },
  // exact: /settings/admins and /settings/security have their own entries above
  { id: 'settings', label: 'Settings', href: '/settings', icon: Settings, order: 100, match: 'exact' },
];

export function sortedNavItems(items: NavItem[] = NAV_ITEMS): NavItem[] {
  return [...items].sort((a, b) => a.order - b.order);
}

export function isNavActive(item: NavItem, pathname: string): boolean {
  const mode = item.match ?? 'prefix';
  if (mode === 'exact') return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
