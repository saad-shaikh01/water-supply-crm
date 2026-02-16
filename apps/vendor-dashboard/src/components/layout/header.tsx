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
    <header className="h-16 border-b bg-background/50 backdrop-blur-xl flex items-center justify-between px-4 md:px-6 sticky top-0 z-30 shrink-0 dark:bg-zinc-950/50">
      <div className="flex items-center gap-4 flex-1">
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="md:hidden hover:bg-accent dark:hover:bg-white/5 transition-colors">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="p-0 w-72 border-r border-border/50">
            <Sidebar className="w-full h-full border-none" />
          </SheetContent>
        </Sheet>

        <div className="hidden md:flex items-center gap-2 px-4 py-2 rounded-full bg-accent/50 dark:bg-white/5 border border-border/50 max-w-sm w-full group focus-within:ring-2 focus-within:ring-primary/20 transition-all duration-300">
          <Search className="h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
          <input 
            type="text" 
            placeholder="Search anything..." 
            className="bg-transparent border-none outline-none text-sm w-full placeholder:text-muted-foreground/50 font-medium"
          />
          <kbd className="hidden lg:inline-flex h-5 select-none items-center gap-1 rounded border bg-muted dark:bg-zinc-900 px-1.5 font-mono text-[10px] font-bold text-muted-foreground opacity-100">
            <span className="text-xs font-bold">⌘</span>K
          </kbd>
        </div>
      </div>

      <div className="flex items-center gap-2 md:gap-4">
        <ThemeToggle />
        <Button variant="ghost" size="icon" className="relative text-muted-foreground hover:text-foreground hover:bg-accent dark:hover:bg-white/5 transition-all">
          <Bell className="h-5 w-5" />
          <span className="absolute top-2.5 right-2.5 w-2 h-2 bg-destructive rounded-full border-2 border-background shadow-sm" />
        </Button>
        <div className="h-8 w-[1px] bg-border/50 mx-1 hidden sm:block" />
        <UserNav />
      </div>
    </header>
  );
}
