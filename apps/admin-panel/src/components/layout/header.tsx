'use client';

import { UserNav } from './user-nav';
import { ThemeToggle } from './theme-toggle';
import { Droplets } from 'lucide-react';

export function Header() {
  return (
    <header className="h-16 border-b bg-background/50 backdrop-blur-xl flex items-center justify-between px-6 sticky top-0 z-30 shrink-0">
      <div className="flex items-center gap-4">
        <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
          <Droplets className="h-5 w-5" />
        </div>
        <h2 className="text-lg font-black tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-primary to-blue-600">
          Admin Panel
        </h2>
      </div>
      <div className="flex items-center gap-4">
        <ThemeToggle />
        <div className="h-8 w-[1px] bg-border/50 mx-1" />
        <UserNav />
      </div>
    </header>
  );
}
