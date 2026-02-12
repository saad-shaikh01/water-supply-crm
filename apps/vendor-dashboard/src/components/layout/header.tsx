'use client';

import { UserNav } from './user-nav';

export function Header() {
  return (
    <header className="h-16 border-b bg-card flex items-center justify-between px-6 shrink-0">
      <div className="flex items-center gap-4">
        <h2 className="text-lg font-semibold text-foreground">Vendor Dashboard</h2>
      </div>
      <div className="flex items-center gap-4">
        <UserNav />
      </div>
    </header>
  );
}
