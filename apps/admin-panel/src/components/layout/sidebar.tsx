'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@water-supply-crm/ui';
import { Droplets } from 'lucide-react';
import { motion } from 'framer-motion';
import { isNavActive, sortedNavItems } from '../../config/nav';
import { useAuthStore } from '../../store/auth.store';

export function Sidebar() {
  const pathname = usePathname() ?? '/';
  const user = useAuthStore((s) => s.user);
  const items = sortedNavItems();

  return (
    <aside className="w-64 border-r bg-card/30 backdrop-blur-xl flex flex-col shrink-0">
      <div className="h-16 flex items-center px-6 border-b bg-background/50">
        <Link href="/" className="flex items-center gap-2 group">
          <div className="p-1.5 rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-all duration-300">
            <Droplets className="h-6 w-6" />
          </div>
          <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-blue-600 tracking-tight">
            WaterCRM
          </span>
        </Link>
      </div>

      <nav className="flex-1 p-4 space-y-1.5 overflow-y-auto scrollbar-none">
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = isNavActive(item, pathname);

          return (
            <Link
              key={item.id}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'group relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200',
                isActive
                  ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/25'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
            >
              <Icon className={cn(
                "h-5 w-5 transition-transform duration-200 group-hover:scale-110",
                isActive ? "text-primary-foreground" : "text-muted-foreground group-hover:text-accent-foreground"
              )} />
              <span>{item.label}</span>
              {isActive && (
                <motion.div
                  layoutId="sidebar-active-pill"
                  className="absolute left-0 w-1 h-6 bg-primary-foreground rounded-r-full"
                  transition={{ type: "spring", stiffness: 300, damping: 30 }}
                />
              )}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t bg-background/50">
        <div className="px-4 py-3 rounded-2xl bg-primary/5 border border-primary/10">
          <p className="text-[10px] uppercase tracking-widest font-bold text-primary">System Role</p>
          <p className="text-sm font-black mt-0.5">{user?.name ?? 'Platform Admin'}</p>
          <p className="text-[11px] text-muted-foreground font-medium">
            {user?.role ? user.role.replace(/_/g, ' ') : 'Platform Controller'}
          </p>
        </div>
      </div>
    </aside>
  );
}
