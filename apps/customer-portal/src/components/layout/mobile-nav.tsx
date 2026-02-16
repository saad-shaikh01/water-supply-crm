'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Receipt, User, Wallet } from 'lucide-react';
import { cn } from '@water-supply-crm/ui';
import { motion } from 'framer-motion';

const navItems = [
  { href: '/home', label: 'Home', icon: Home },
  { href: '/transactions', label: 'History', icon: Receipt },
  { href: '/profile', label: 'Account', icon: User },
];

export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-50 px-4 pb-4">
      <div className="bg-background/80 backdrop-blur-xl border border-border/50 rounded-2xl shadow-2xl flex items-center justify-around h-16 px-2">
        {navItems.map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "relative flex flex-col items-center justify-center flex-1 h-full gap-1 transition-all duration-300",
                isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className={cn("h-5 w-5 transition-transform duration-300", isActive && "scale-110")} />
              <span className="text-[10px] font-bold uppercase tracking-tighter">{label}</span>
              {isActive && (
                <motion.div
                  layoutId="bottom-nav-indicator"
                  className="absolute -top-2 w-10 h-1 bg-primary rounded-full shadow-[0_-4px_10px_rgba(var(--primary),0.5)]"
                  transition={{ type: "spring", stiffness: 300, damping: 30 }}
                />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
