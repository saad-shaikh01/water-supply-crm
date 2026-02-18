'use client';

import { Menu, Search, Bell } from 'lucide-react';
import { UserNav } from './user-nav';
import { Sidebar } from './sidebar';
import { ThemeToggle } from './theme-toggle';
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  Button,
  Input
} from '@water-supply-crm/ui';

export function Header() {
  return (
    <header className="h-20 bg-background/40 backdrop-blur-xl flex items-center justify-between px-6 md:px-10 sticky top-0 z-40 shrink-0 border-b border-white/5 shadow-sm">
      <div className="flex items-center gap-6 flex-1">
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="md:hidden hover:bg-white/10 transition-colors rounded-xl h-10 w-10">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="p-0 w-80 border-r border-white/10 glass-panel">
            <Sidebar className="w-full h-full border-none shadow-none" />
          </SheetContent>
        </Sheet>

        <div className="hidden md:flex items-center gap-3 px-5 py-2.5 rounded-2xl bg-white/5 border border-white/10 dark:bg-zinc-900/40 max-w-md w-full group focus-within:ring-2 focus-within:ring-primary/40 focus-within:bg-white/10 transition-all duration-300 shadow-inner">
          <Search className="h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
          <input 
            type="text" 
            placeholder="Search dashboard, customers, routes..." 
            className="bg-transparent border-none outline-none text-[13px] w-full placeholder:text-muted-foreground/40 font-bold tracking-tight"
          />
          <kbd className="hidden lg:inline-flex h-6 select-none items-center gap-1 rounded-md border border-white/10 bg-black/20 px-2 font-mono text-[10px] font-black text-muted-foreground/60 shadow-sm">
            ⌘K
          </kbd>
        </div>
      </div>

      <div className="flex items-center gap-3 md:gap-6">
        <ThemeToggle />
        <Button variant="ghost" size="icon" className="relative text-muted-foreground hover:text-primary hover:bg-primary/5 rounded-xl h-10 w-10 transition-all">
          <Bell className="h-5 w-5" />
          <span className="absolute top-2 right-2 w-2.5 h-2.5 bg-primary rounded-full border-2 border-background animate-pulse shadow-[0_0_10px_rgba(59,130,246,0.5)]" />
        </Button>
        <div className="h-6 w-[1px] bg-white/10 mx-1 hidden sm:block" />
        <UserNav />
      </div>
    </header>
  );
}
