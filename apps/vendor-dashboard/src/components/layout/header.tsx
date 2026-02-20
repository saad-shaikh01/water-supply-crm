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
    <header className="h-20 bg-background/20 backdrop-blur-3xl flex items-center justify-between px-6 md:px-12 sticky top-0 z-40 shrink-0 border-b border-border/50 dark:border-white/5 shadow-2xl">
      <div className="flex items-center gap-8 flex-1">
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="md:hidden hover:bg-muted dark:hover:bg-white/5 transition-all rounded-xl h-12 w-12 border border-border/50 dark:border-white/5">
              <Menu className="h-6 w-6" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="p-0 w-80 border-r border-border dark:border-white/5 glass-panel">
            <Sidebar className="w-full h-full border-none shadow-none" />
          </SheetContent>
        </Sheet>

        <div className="hidden md:flex items-center gap-4 px-6 py-3 rounded-2xl bg-muted/50 dark:bg-black/20 border border-border/50 dark:border-white/5 max-w-lg w-full group focus-within:ring-2 focus-within:ring-primary/40 focus-within:bg-background dark:focus-within:bg-black/40 transition-all duration-500 shadow-xl dark:shadow-2xl">
          <Search className="h-4 w-4 text-muted-foreground group-focus-within:text-primary group-focus-within:scale-110 transition-all" />
          <input 
            type="text" 
            placeholder="Search anything..." 
            className="bg-transparent border-none outline-none text-[13px] w-full placeholder:text-muted-foreground/50 dark:placeholder:text-muted-foreground/30 font-bold tracking-tight text-foreground"
          />
          <kbd className="hidden lg:inline-flex h-6 select-none items-center gap-1 rounded-md border border-border dark:border-white/10 bg-muted dark:bg-black/40 px-2 font-mono text-[10px] font-black text-muted-foreground/60 dark:text-muted-foreground/40 shadow-sm">
            <span className="text-xs">⌘</span>K
          </kbd>
        </div>
      </div>

      <div className="flex items-center gap-4 md:gap-8">
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button variant="ghost" size="icon" className="relative text-muted-foreground hover:text-primary hover:bg-primary/5 rounded-xl h-12 w-12 transition-all border border-transparent hover:border-border/50 dark:hover:border-white/5">
            <Bell className="h-5 w-5" />
            <span className="absolute top-3 right-3 w-2 h-2 bg-primary rounded-full shadow-[0_0_12px_rgba(0,212,255,1)] animate-pulse" />
          </Button>
        </div>
        <div className="h-8 w-px bg-border dark:bg-white/5 mx-2 hidden sm:block" />
        <UserNav />
      </div>
    </header>
  );
}
