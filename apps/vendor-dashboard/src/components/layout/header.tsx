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
    <header className="h-20 bg-white/[0.02] backdrop-blur-3xl flex items-center justify-between px-6 md:px-12 sticky top-0 z-40 shrink-0 border-b border-border shadow-2xl">
      <div className="flex items-center gap-8 flex-1">
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="md:hidden hover:bg-white/5 rounded-xl h-12 w-12 border border-border">
              <Menu className="h-6 w-6 text-white" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="p-0 w-80 border-r border-border bg-transparent">
            <Sidebar className="w-full h-full border-none shadow-none" />
          </SheetContent>
        </Sheet>

        <div className="hidden md:flex items-center gap-4 px-6 py-2.5 rounded-xl bg-white/[0.03] border border-border max-w-md w-full focus-within:border-primary/50 focus-within:ring-4 focus-within:ring-primary/10 transition-colors shadow-xl">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input 
            type="text" 
            placeholder="Search anything..." 
            className="bg-transparent border-none outline-none text-sm w-full placeholder:text-muted-foreground/50 font-medium tracking-tight text-white"
          />
          <kbd className="hidden lg:inline-flex h-5 select-none items-center gap-1 rounded border border-border bg-white/5 px-1.5 font-mono text-[10px] text-muted-foreground">
            <span className="text-xs">⌘</span>K
          </kbd>
        </div>
      </div>

      <div className="flex items-center gap-4 md:gap-6">
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button variant="ghost" size="icon" className="relative text-muted-foreground hover:text-white hover:bg-white/5 rounded-xl h-11 w-11 transition-colors border border-transparent hover:border-border">
            <Bell className="h-5 w-5" />
            <span className="absolute top-3 right-3 w-2 h-2 bg-primary rounded-full shadow-[0_0_10px_rgba(99,102,241,1)]" />
          </Button>
        </div>
        <div className="h-8 w-px bg-border/50 mx-2 hidden sm:block" />
        <UserNav />
      </div>
    </header>
  );
}
