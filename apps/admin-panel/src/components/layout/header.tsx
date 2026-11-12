'use client';

import { UserNav } from './user-nav';
import { ThemeToggle } from './theme-toggle';
import { MaintenanceBanner } from '../../features/settings/components/maintenance-banner';
import { Droplets, Menu } from 'lucide-react';
import { Button } from '@water-supply-crm/ui';

export function Header({ onMenuClick, menuOpen = false }: { onMenuClick?: () => void; menuOpen?: boolean }) {
  return (
    <>
      <MaintenanceBanner />
      <header className="h-16 border-b bg-background/50 backdrop-blur-xl flex items-center justify-between gap-2 px-3 sm:px-6 sticky top-0 z-30 shrink-0">
        <div className="flex items-center gap-2 sm:gap-4 min-w-0">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden h-10 w-10 shrink-0"
            aria-label="Open navigation menu"
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            aria-haspopup="dialog"
            onClick={onMenuClick}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <div className="p-1.5 rounded-lg bg-primary/10 text-primary shrink-0">
            <Droplets className="h-5 w-5" />
          </div>
          <h2 className="truncate text-lg font-black tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-primary to-blue-600">
            Admin Panel
          </h2>
        </div>
        <div className="flex items-center gap-2 sm:gap-4 shrink-0">
          <ThemeToggle />
          <div className="h-8 w-[1px] bg-border/50 mx-1" />
          <UserNav />
        </div>
      </header>
    </>
  );
}
