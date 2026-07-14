'use client';

import { useUnreadBadge } from '../hooks/use-conversations';

/**
 * Small count pill for the Sidebar nav entries (Phase 4). Kept inside the
 * communication feature (not the layout) so the layout never imports a
 * feature hook directly.
 */
export function UnreadBadge() {
  const { data } = useUnreadBadge();
  const count = data?.count ?? 0;
  if (count === 0) return null;

  return (
    <span className="ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-black leading-none">
      {count > 99 ? '99+' : count}
    </span>
  );
}
